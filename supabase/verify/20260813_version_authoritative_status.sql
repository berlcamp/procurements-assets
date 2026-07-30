-- Assertions for 20260813_version_authoritative_status.sql
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/verify/20260813_version_authoritative_status.sql
-- The trailing SELECT prints PASS even after the DO block aborts, so without
-- ON_ERROR_STOP you MUST read the whole output.

DO $$
DECLARE
  v_src TEXT;
  v_n   INTEGER;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. The read model exists AND runs as the caller.
  --
  --    A plain Postgres view executes with the OWNER's privileges, so it would
  --    bypass every RLS policy on ppmps/ppmp_versions and hand one division's
  --    plans to another. security_invoker is what makes the view safe, and it
  --    is invisible in the column list -- assert it explicitly.
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'procurements' AND table_name = 'v_ppmp_current_state'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: view v_ppmp_current_state missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements'
       AND c.relname = 'v_ppmp_current_state'
       AND c.reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: v_ppmp_current_state is not security_invoker. It would run as its '
      'owner and return other divisions'' PPMPs to any authenticated caller.';
  END IF;

  -- ---------------------------------------------------------------
  -- 2. The flag column.
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name   = 'ppmps'
       AND column_name  = 'has_open_amendment'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmps.has_open_amendment missing';
  END IF;

  -- ---------------------------------------------------------------
  -- 3. create_ppmp_amendment no longer knocks the PARENT back to draft.
  --
  --    ANCHORED ON THE ppmps UPDATE, not on the bare token. The obvious
  --    assertion -- v_src ~ 'status\s*=\s*''draft''' -- MATCHES CORRECT CODE:
  --    the function legitimately tests `AND status = 'draft'` against
  --    ppmp_versions when refusing a second concurrent amendment. Using the
  --    loose form would fail on a correct implementation and invite someone to
  --    delete that real guard to make the script pass.
  -- ---------------------------------------------------------------
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^\n]*', '', 'g'
         ) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'create_ppmp_amendment';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_ppmp_amendment() missing';
  END IF;

  IF v_src ~ 'UPDATE\s+procurements\.ppmps\s+SET[^;]*status\s*=\s*''draft''' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment still resets ppmps.status to draft. '
      'That erases the fact that an approved version exists and is still operative.';
  END IF;

  IF v_src !~ 'has_open_amendment\s*=\s*true' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment does not set has_open_amendment';
  END IF;

  -- The 20260809 in-flight guard and the concurrent-amendment guard must both
  -- survive this rewrite.
  IF v_src !~ 'ppmp_has_inflight_procurement' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment lost the in-flight procurement guard '
      'added in 20260809';
  END IF;

  -- ---------------------------------------------------------------
  -- 4. submit_ppmp validates the VERSION.
  -- ---------------------------------------------------------------
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^\n]*', '', 'g'
         ) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'submit_ppmp';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: submit_ppmp() missing';
  END IF;

  IF v_src !~ 'has_open_amendment' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: submit_ppmp does not admit an open amendment. With the parent '
      'no longer flipped to draft, amendments could be opened and never submitted.';
  END IF;

  IF v_src !~ 'FROM procurements\.ppmp_versions WHERE id = v_version_id' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: submit_ppmp does not check the VERSION status. The parent gate '
      'is now permissive, so this is the only thing stopping a resubmission.';
  END IF;

  -- ---------------------------------------------------------------
  -- 5. The flag-sync trigger, and P1: no COALESCE(NEW.x, OLD.x).
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements' AND c.relname = 'ppmp_versions'
       AND t.tgname = 'trg_sync_ppmp_open_amendment_flag' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_sync_ppmp_open_amendment_flag missing';
  END IF;

  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^\n]*', '', 'g'
         ) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'sync_ppmp_open_amendment_flag';

  IF v_src ~ 'COALESCE\s*\(\s*NEW\.ppmp_id\s*,\s*OLD\.ppmp_id\s*\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: sync_ppmp_open_amendment_flag resolves the parent with '
      'COALESCE(NEW.ppmp_id, OLD.ppmp_id), which always yields NEW on UPDATE and leaves '
      'a reparented version''s old parent stale. Handle both sides.';
  END IF;

  -- ---------------------------------------------------------------
  -- 6. *** EVERY SUSPENDED TRIGGER IS BACK ON. ***
  --
  --    Backfill 2 disables trg_auto_populate_app_from_ppmp and
  --    trg_sync_planning_round_office_status. A migration that leaves a guard
  --    disabled is worse than one that fails, and nothing else would notice.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_n
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'procurements' AND c.relname = 'ppmps'
     AND t.tgname IN ('trg_auto_populate_app_from_ppmp','trg_sync_planning_round_office_status')
     AND t.tgenabled = 'D';

  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % trigger(s) on procurements.ppmps are still DISABLED after the '
      'backfill. Re-enable before using this database.', v_n;
  END IF;

  -- ---------------------------------------------------------------
  -- 7. Data invariant: no PPMP reads 'draft' while carrying an approved version
  --    and an open amendment. That is the exact state backfill 2 repairs.
  --    Passes vacuously on an empty table, which is acceptable -- the repair
  --    itself is the guarantee.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_n
    FROM procurements.ppmps p
   WHERE p.status = 'draft'
     AND p.has_open_amendment = true
     AND EXISTS (
       SELECT 1 FROM procurements.ppmp_versions pv
        WHERE pv.ppmp_id = p.id AND pv.status = 'approved'
     );
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % PPMP(s) still read draft while an approved version exists', v_n;
  END IF;
END $$;

SELECT 'PASS: 20260813_version_authoritative_status' AS result;
