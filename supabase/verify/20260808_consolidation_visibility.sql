DO $$
DECLARE
  v_def       TEXT;
  v_src       TEXT;
  v_acl       aclitem[];
  v_orphaned  INTEGER;
BEGIN
  -- ----------------------------------------------------------------
  -- 1. Schema. This is the first assertion deliberately: it is the one that
  --    fails on an unmigrated database, so a run before `supabase db push`
  --    stops here with an unambiguous message.
  -- ----------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name   = 'ppmps'
       AND column_name  = 'consolidation_status'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmps.consolidation_status missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name   = 'ppmps'
       AND column_name  = 'consolidation_error'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmps.consolidation_error missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name   = 'ppmps'
       AND column_name  = 'consolidated_at'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmps.consolidated_at missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'procurements'
       AND indexname  = 'idx_ppmps_consolidation_failed'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: idx_ppmps_consolidation_failed missing';
  END IF;

  -- ----------------------------------------------------------------
  -- 2. record_consolidation_failure(UUID, TEXT)
  --
  --    Filtered by pronargs, never by proname alone. plpgsql SELECT ... INTO
  --    silently keeps an ARBITRARY row when several match, so an overload
  --    added later would make every check below test a random definition.
  -- ----------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname  = 'procurements'
       AND p.proname  = 'record_consolidation_failure'
       AND p.pronargs = 2
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: record_consolidation_failure(UUID, TEXT) missing';
  END IF;

  -- It is SECURITY DEFINER with no division check and no permission check, and
  -- the procurements schema is exposed over PostgREST. Left EXECUTE-able by
  -- PUBLIC it is a live endpoint any authenticated user can call to mark an
  -- arbitrary PPMP in any division as failed and fan out notifications.
  -- proacl IS NULL means "default ACL", which grants EXECUTE to PUBLIC — so a
  -- NULL acl fails this assertion rather than passing it vacuously.
  SELECT p.proacl INTO v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname  = 'procurements'
     AND p.proname  = 'record_consolidation_failure'
     AND p.pronargs = 2;

  IF v_acl IS NULL
     OR EXISTS (
       SELECT 1 FROM aclexplode(v_acl) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
     )
  THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: record_consolidation_failure is EXECUTE-able by PUBLIC — REVOKE is missing';
  END IF;

  -- ----------------------------------------------------------------
  -- 3. auto_populate_app_from_ppmp()
  -- ----------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname  = 'procurements'
     AND p.proname  = 'auto_populate_app_from_ppmp'
     AND p.pronargs = 0;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: auto_populate_app_from_ppmp() missing';
  END IF;

  -- ----------------------------------------------------------------
  -- READ THIS BEFORE TRUSTING THE CHECKS BELOW.
  --
  -- (a) They run against v_src, NOT v_def. pg_get_functiondef() returns the
  --     source INCLUDING comments, and this function now carries long comments
  --     that NAME every column asserted below — precisely because they explain
  --     why those columns must not be dropped again. Matched against the raw
  --     definition, every assertion below would PASS on comment text alone, so
  --     the single most likely regression (someone drops the columns from the
  --     INSERT/SELECT but leaves the comment about not dropping them) would
  --     sail straight through. v_src strips SQL line comments first.
  --     Add new assertions against v_src; NEVER against v_def.
  --
  -- (b) A substring check can NEVER detect a POSITIONAL SWAP between an INSERT
  --     column list and its SELECT list. Transpose two same-typed columns —
  --     say source_ppmp_id and source_ppmp_version_id, both UUID, or two of the
  --     five consecutive TEXT date fields — and every assertion here still
  --     passes while every consolidation writes each value into the other's
  --     column. Postgres will not catch it either, since the types match. Only
  --     a round-trip test (consolidate a PPMP whose every column holds a
  --     DISTINCT sentinel value, then assert each sentinel landed in its own
  --     column) can detect that class of defect. These guards catch OMISSION,
  --     not MISALIGNMENT. Do not over-trust them.
  -- ----------------------------------------------------------------
  v_src := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');

  -- 3a. Failure recording — the point of this migration.
  IF v_src NOT LIKE '%consolidation_status%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp does not record consolidation_status';
  END IF;

  IF v_src NOT LIKE '%record_consolidation_failure%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp does not report failures';
  END IF;

  IF v_src NOT LIKE '%''consolidated''%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp never marks a PPMP consolidated';
  END IF;

  -- 3b. The status guard (20260516_app_cse_schedule_columns.sql:68-69).
  --     This is what makes it safe for this function, and for any backfill, to
  --     write consolidation_* columns on procurements.ppmps without recursing
  --     or cascading into the 20260806-guarded APP tables. If a later edit
  --     drops it, those writes stop short-circuiting.
  IF v_src NOT LIKE '%NEW.status <> ''approved'' OR OLD.status = ''approved''%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp lost the status guard (NEW.status <> ''approved'' OR OLD.status = ''approved'') — consolidation writes back onto ppmps can now recurse or cascade into the APP tables';
  END IF;

  -- 3c. Clone fidelity. The supplemental carry-forward clone dropped four
  --     app_items columns added by later migrations, and neither INSERT wrote
  --     source_ppmp_version_id. Guard against the same omissions recurring.
  --     Dropping source_ppmp_lot_item_ids is the worst of them: NULL MEANS
  --     "covers every line of the source PPMP lot", so a split lot produced two
  --     NULL clones each claiming the full line set at half the budget.
  IF v_src NOT LIKE '%source_ppmp_version_id%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp does not write source_ppmp_version_id';
  END IF;

  IF v_src NOT LIKE '%source_ppmp_lot_item_ids%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp does not carry forward source_ppmp_lot_item_ids';
  END IF;

  IF v_src NOT LIKE '%indicative_budget%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp does not carry forward indicative_budget';
  END IF;

  IF v_src NOT LIKE '%budget_adjusted_by%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp does not carry forward budget_adjusted_by';
  END IF;

  IF v_src NOT LIKE '%budget_adjusted_at%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp does not carry forward budget_adjusted_at';
  END IF;

  -- 3d. The CSE / schedule propagation this function's live definition
  --     introduced (20260516). It is the thing most likely to be silently
  --     reverted by a copy-paste of the older 20260405 / 20240604 / 20240505
  --     bodies, all three of which are still on disk and still contain a
  --     definition of this function.
  IF v_src NOT LIKE '%is_cse%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp does not propagate is_cse — a pre-20260516 definition has been restored over it';
  END IF;

  IF v_src NOT LIKE '%contract_signing_date%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp does not propagate the GPPB schedule dates — a pre-20260516 definition has been restored over it';
  END IF;

  -- ----------------------------------------------------------------
  -- 4. Backfill completeness.
  --
  --    NON-BINDING ON EMPTY DATA: a database with no approved PPMPs passes
  --    this trivially. It is worth keeping anyway — on a populated database it
  --    is the only check here that proves section 2 of the migration actually
  --    ran, rather than merely that the columns exist.
  -- ----------------------------------------------------------------
  SELECT COUNT(*) INTO v_orphaned
    FROM procurements.ppmps p
   WHERE p.status               = 'approved'
     AND p.deleted_at           IS NULL
     AND p.consolidation_status = 'pending';

  IF v_orphaned > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % approved PPMP(s) still have consolidation_status = ''pending'' — the backfill did not classify them',
      v_orphaned;
  END IF;
END $$;

-- Operational readout. Any 'failed' count is PRE-EXISTING data loss that the
-- old silent RETURN NEW caused: approved plans currently missing from the APP,
-- each needing an APP amendment to recover.
--
--   SELECT consolidation_status, COUNT(*)
--     FROM procurements.ppmps
--    WHERE status = 'approved' AND deleted_at IS NULL
--    GROUP BY consolidation_status;

SELECT 'PASS: 20260808_consolidation_visibility' AS result;
