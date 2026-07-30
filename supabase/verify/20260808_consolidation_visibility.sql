DO $$
DECLARE
  v_def        TEXT;
  v_src        TEXT;
  v_acl        aclitem[];
  v_orphaned   INTEGER;
  v_secdef     BOOLEAN;
  v_chk_values TEXT[];
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

  -- The consolidation_status CHECK is the only thing stopping a typo'd status
  -- ('FAILED', 'error', '') from being written by a future edit or a manual
  -- remediation UPDATE, which would then sit invisible to
  -- idx_ppmps_consolidation_failed and to every dashboard filter. Assert both
  -- that it exists and that it admits EXACTLY the four intended values —
  -- a substring check for 'failed' alone would pass a constraint that had
  -- quietly grown a fifth escape-hatch value.
  --
  -- Aggregated, never SELECT ... INTO: several CHECKs could name the column and
  -- plpgsql INTO would keep an arbitrary one. pg_get_constraintdef() renders
  -- the IN-list as = ANY (ARRAY['pending'::text, ...]), so the single-quoted
  -- tokens are exactly the admissible values.
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
    INTO v_chk_values
    FROM pg_constraint c
    JOIN pg_class     t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL regexp_matches(
      pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g'
    ) AS m
   WHERE n.nspname  = 'procurements'
     AND t.relname  = 'ppmps'
     AND c.contype  = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%consolidation_status%';

  IF v_chk_values IS NULL THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: no CHECK constraint on procurements.ppmps.consolidation_status';
  END IF;

  IF v_chk_values <> ARRAY['consolidated','failed','not_applicable','pending'] THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmps.consolidation_status CHECK admits % — expected exactly {consolidated,failed,not_applicable,pending}',
      v_chk_values;
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

  -- SECURITY DEFINER is load-bearing, not incidental. Its only caller is an
  -- AFTER UPDATE trigger running as whichever role approved the PPMP, and the
  -- function writes procurements.ppmps, approval_logs and notifications rows
  -- for OTHER users under RLS. Dropped to SECURITY INVOKER it would start
  -- failing — inside a trigger, on the error path — and roll back the very
  -- approval this whole migration exists to protect.
  SELECT p.prosecdef INTO v_secdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname  = 'procurements'
     AND p.proname  = 'record_consolidation_failure'
     AND p.pronargs = 2;

  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: record_consolidation_failure is not SECURITY DEFINER';
  END IF;

  -- It is SECURITY DEFINER with no division check and no permission check, and
  -- the procurements schema is exposed over PostgREST. Left EXECUTE-able by
  -- PUBLIC it is a live endpoint any authenticated user can call to mark an
  -- arbitrary PPMP in any division as failed and fan out notifications.
  -- proacl IS NULL means "default ACL", which grants EXECUTE to PUBLIC — so a
  -- NULL acl fails this assertion rather than passing it vacuously.
  --
  -- SCOPE LIMIT, READ BEFORE TRUSTING: this tests grantee = 0 (PUBLIC) ONLY.
  -- It says nothing about grants to named roles, and in a Supabase project
  -- `authenticated` and `anon` are named roles. A blanket
  --   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA procurements TO authenticated;
  -- added later would re-open exactly the endpoint described above while this
  -- assertion still passes, because PUBLIC would remain unprivileged. If such
  -- a grant is ever introduced, this check goes vacuous and must be widened to
  -- enumerate every grantee.
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

  -- 2a. The three properties of record_consolidation_failure's BODY that this
  --     fix round installed. Matched against comment-stripped source for the
  --     same reason as section 3 below: the body's own comments name every one
  --     of these tokens (they explain why each must not be removed), so a check
  --     against the raw definition would pass on comment text alone.
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname  = 'procurements'
     AND p.proname  = 'record_consolidation_failure'
     AND p.pronargs = 2;

  v_src := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');

  -- (i) The never-raise wrapper. This function runs inside an AFTER UPDATE
  --     trigger in the HOPE approval's transaction; any escaping exception
  --     rolls back the approval. Two full statement-by-statement reviews of
  --     this body each missed a live raise, so the guarantee is structural.
  IF v_src NOT LIKE '%EXCEPTION WHEN OTHERS THEN%'
     OR v_src NOT LIKE '%RAISE WARNING%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: record_consolidation_failure lost its EXCEPTION WHEN OTHERS wrapper — a side-write failure can now roll back the HOPE approval';
  END IF;

  -- (ii) consolidated_at is cleared, so 'failed' never carries a timestamp
  --      asserting a success that the amendment soft-delete has since undone.
  --
  --      Anchored to the ASSIGNMENT, not to a loose '%consolidated_at%NULL%'.
  --      That looser form was vacuous: the notification predicate later in this
  --      same body contains 'up.deleted_at IS NULL' and 'ur.revoked_at IS NULL',
  --      either of which satisfies a trailing %NULL%. Reverting the clear to
  --      'consolidated_at = NOW()' — the most plausible regression — passed the
  --      loose check. Proven by mutation, not assumed.
  IF v_src !~ 'consolidated_at\s*=\s*NULL' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: record_consolidation_failure does not clear consolidated_at';
  END IF;

  -- (iii) The originating office is notified, not only the BAC. Without this
  --       the office still believes its approved plan is in the APP, which is
  --       the exact harm this migration opens by describing.
  IF v_src NOT LIKE '%office_id = v_ppmp.office_id%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: record_consolidation_failure no longer notifies the originating office';
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

  -- 3c. VERSION SCOPING on the fresh-populate INSERT.
  --
  --     approve_ppmp supersedes only versions whose status is
  --     NOT IN ('approved','superseded') (20260803:58-63), so a previously
  --     approved ppmp_version keeps status = 'approved' forever. The
  --     consolidation join used to trust status alone, and because
  --     create_ppmp_amendment clones v1's content into v2, every amendment
  --     approval inserted every project TWICE, at FULL budget. Since 20260807
  --     the duplicates even carry different source_ppmp_version_id values, so
  --     they read as two legitimate distinct sources. Scoping to
  --     version_number = NEW.current_version is the whole fix; it must not
  --     silently regress.
  --
  --     REGEX ANCHORED TO THE COMPARISON, NOT A SUBSTRING. A bare
  --     '%current_version%' check would be VACUOUS — the token also appears in
  --     `v_is_amendment := (NEW.current_version > 1)` and in the supplemental
  --     version's amendment_justification string, both of which survive the
  --     predicate's total removal. Verified: with the predicate deleted, a
  --     '%current_version%' LIKE still passed. Same failure mode as the
  --     '%consolidated_at%NULL%' check in section 2a.
  --
  --     \M (end-of-word) and the negative lookahead are not decoration: without
  --     them `NEW.current_versionx` and `NEW.current_version - 1` both passed.
  --
  --     NEGATIVE-TESTED BY MUTATION on a throwaway cluster, not by deletion
  --     alone. This assertion fires for all of: predicate deleted; deleted but
  --     a comment still naming it (v_src only — the raw definition passes it
  --     vacuously, which is why this must never be run against v_def);
  --     `= NEW.current_version - 1`; `>= NEW.current_version`;
  --     `pv.version_number = pv.version_number`;
  --     `NEW.current_version = pv.version_number` (operands reversed — a
  --     cosmetic rewrite DOES trip this, deliberately: fail loud, then restore
  --     the canonical form); `= NEW.current_versionx`; `= 1`. It does not fire
  --     on the shipped body.
  IF v_src !~ 'version_number\s*=\s*NEW\.current_version\M(?!\s*[-+*/])' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp no longer scopes the fresh-populate INSERT to pv.version_number = NEW.current_version — every amendment approval will re-consolidate previously approved PPMP versions, duplicating each project at full budget';
  END IF;

  -- 3d. CARRY-FORWARD SOURCE VERSION on the supplemental clone.
  --
  --     app_versions.status is one of ('draft','under_review',
  --     'bac_finalization','final','approved','superseded')
  --     (20240601_app_tables.sql:45-46). The editable-version lookup takes
  --     NOT IN ('final','approved','superseded'); the versions that ARE the
  --     current locked plan are its exact complement minus 'superseded', i.e.
  --     IN ('final','approved'). This asserted set must admit BOTH values.
  --
  --     It read `status = 'approved'`, which broke in two separate ways:
  --       (1) during the 'final' window of a division's first APP year there is
  --           no 'approved' version at all, so the lookup returned NULL and the
  --           clone was skipped — the supplemental held only the amending
  --           PPMP's items, every other office's lines gone; and
  --       (2) approve_app supersedes only versions NOT IN
  --           ('approved','superseded') (20240603_app_rpc.sql:531-536), so a
  --           previously approved version stays 'approved' forever. With v1
  --           'approved' and v2 'final' the ORDER BY picked the STALE v1 and
  --           silently dropped everything added in v2.
  --     Both were reproduced on a throwaway cluster before the fix and shown
  --     absent after it.
  --
  --     ANCHORED TO THE PREDICATE, NOT A SUBSTRING. A bare '%''final''%' check
  --     would be COMPLETELY VACUOUS here: 'final' and 'approved' each appear
  --     several times elsewhere in this same body — the editable lookup
  --     (NOT IN ('final','approved','superseded')), the apps status reset
  --     (IN ('approved','final','posted')) and the PPMP-side join
  --     (pv.status = 'approved') — all of which survive this predicate's total
  --     removal.
  --
  --     `status\s+IN` (not `status.*IN`) is what keeps the editable lookup from
  --     satisfying this: in `status NOT IN (...)` the token after the
  --     whitespace is NOT, so the match cannot start there. And requiring
  --     `'final'\s*,\s*'approved'\s*\)` — closing paren, exactly two values —
  --     is what keeps the three-value apps reset from satisfying it.
  --
  --     NEGATIVE-TESTED BY MUTATION on a throwaway cluster, not by deletion
  --     alone. This assertion fires for all of: reverted to
  --     `status = 'approved'`; narrowed to `status = 'final'`;
  --     `status IN ('final')`; `status IN ('approved')`;
  --     `status NOT IN ('final', 'approved')`; and the predicate deleted
  --     outright. It ALSO fires on `status IN ('approved', 'final')` — a
  --     semantically identical reordering. That is deliberate, same as 3c: fail
  --     loud, then restore the canonical form. It does not fire on the shipped
  --     body.
  --
  --     ON v_src RATHER THAN v_def, MEASURED RATHER THAN ASSUMED. With the
  --     comments EXACTLY as they ship today, deleting the predicate is caught
  --     against v_def too — the body's prose currently writes the set as
  --     "i.e. IN ('final','approved')", without the leading `status` token the
  --     regex needs. That is luck, not safety, and it was tested: rewording
  --     that one comment to "i.e. status IN ('final', 'approved')" — the most
  --     natural way anyone would phrase it — and deleting the predicate makes
  --     the v_def form PASS VACUOUSLY while this v_src form still fires.
  --     Verified both ways on a throwaway cluster. The body's comments now
  --     name both values several times over, so v_src is mandatory here.
  IF v_src !~ 'status\s+IN\s*\(\s*''final''\s*,\s*''approved''\s*\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: auto_populate_app_from_ppmp no longer sources the supplemental carry-forward clone from status IN (''final'', ''approved'') — the clone will be skipped during the ''final'' window (empty supplemental) or will clone a stale previously-approved version (silent loss of everything added since)';
  END IF;

  -- 3e. Clone fidelity. The supplemental carry-forward clone dropped four
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

  -- 3f. The CSE / schedule propagation this function's live definition
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
