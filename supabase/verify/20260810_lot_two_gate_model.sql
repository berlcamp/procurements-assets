-- Assertions for 20260810_lot_two_gate_model.sql
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/verify/20260810_lot_two_gate_model.sql
-- The trailing SELECT prints PASS even after the DO block aborts, so without
-- ON_ERROR_STOP you MUST read the whole output.
--
-- Section 6 is the one that matters most. This migration's real risk is not that
-- the new states are missing -- it is that a reader of the RETIRED 'finalized'
-- value was left behind, which fails silently: the amendment guard from 20260809
-- would stop blocking, and composed lots would become editable again.

DO $$
DECLARE
  v_def  TEXT;
  v_code TEXT;
  v_n    INTEGER;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. The status CHECK admits the two new states and has retired the old one
  -- ---------------------------------------------------------------
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
    JOIN pg_class t     ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'procurements'
     AND t.relname = 'app_lots'
     AND c.conname = 'app_lots_status_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_lots_status_check does not exist';
  END IF;

  IF position('composed' in v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: status CHECK does not allow ''composed'' (got: %)', v_def;
  END IF;

  IF position('released' in v_def) = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: status CHECK does not allow ''released'' (got: %)', v_def;
  END IF;

  -- The retirement is the point of the migration, so assert it positively.
  IF position('finalized' in v_def) > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: status CHECK still admits the retired value ''finalized'' (got: %)', v_def;
  END IF;

  -- ---------------------------------------------------------------
  -- 2. Columns
  -- ---------------------------------------------------------------
  FOR v_code IN
    SELECT unnest(ARRAY['is_early_procurement','epa_authorized_by','epa_authorized_at',
                        'epa_justification','released_by','released_at'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'procurements'
         AND table_name   = 'app_lots'
         AND column_name  = v_code
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: app_lots.% missing', v_code;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 3. Functions
  -- ---------------------------------------------------------------
  FOR v_code IN
    SELECT unnest(ARRAY['release_app_lot','release_all_app_lots','authorize_epa_lot'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'procurements' AND p.proname = v_code
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %() missing', v_code;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 4. No row carries the retired value.
  --    (Near-vacuous once the CHECK is in place -- kept as a backstop in case
  --    the constraint is ever dropped without remapping.)
  -- ---------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM procurements.app_lots WHERE status = 'finalized') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: lots still carry the retired status ''finalized''';
  END IF;

  -- Every live lot must sit in the new domain.
  SELECT COUNT(*) INTO v_n
    FROM procurements.app_lots
   WHERE status NOT IN ('draft','composed','released','in_procurement');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % lots carry a status outside the new domain', v_n;
  END IF;

  -- ---------------------------------------------------------------
  -- 5. Permissions seeded AND granted. Seeding without granting leaves the
  --    feature unreachable, which is the failure mode a bare
  --    "does the code exist" check misses.
  -- ---------------------------------------------------------------
  FOR v_code IN SELECT unnest(ARRAY['app.release_lots','app.authorize_epa'])
  LOOP
    IF NOT EXISTS (SELECT 1 FROM procurements.permissions WHERE code = v_code) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: % permission not seeded', v_code;
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM procurements.role_permissions rp
        JOIN procurements.permissions p ON p.id = rp.permission_id
       WHERE p.code = v_code
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: % is seeded but granted to no role', v_code;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 6. THE SWEEP. No function anywhere in `procurements` may still test for the
  --    retired value in CODE.
  --
  --    Comments are stripped first, because this migration's own explanatory
  --    comments legitimately name 'finalized'. Both `--` line comments and
  --    /* */ block comments are removed: handling only `--` was flagged as a
  --    latent hole in an earlier task's verify script, where rewriting one
  --    comment into block form would have let the real defect back in silently.
  --
  --    prokind = 'f' excludes aggregates, for which pg_get_functiondef() raises.
  -- ---------------------------------------------------------------
  SELECT string_agg(proname, ', ' ORDER BY proname) INTO v_code
    FROM (
      SELECT p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname   = 'procurements'
         AND p.prokind   = 'f'
         AND regexp_replace(
               regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
               '--[^\n]*', '', 'g'
             ) ~ '''finalized'''
    ) t;

  IF v_code IS NOT NULL THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: these functions still test the retired lot status ''finalized'': %. '
      'Retiring a CHECK value requires sweeping every reader, not just the ones the migration replaces.',
      v_code;
  END IF;

  -- ---------------------------------------------------------------
  -- 7. The amendment guard's successor predicate is 'released', NOT 'composed'.
  --
  --    Anchored on the exact predicate rather than on the token 'released',
  --    which also appears in released_by/released_at and would pass vacuously.
  -- ---------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'ppmp_has_inflight_procurement';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp_has_inflight_procurement() is missing';
  END IF;

  IF v_def !~ 'al\.status\s+IN\s*\(\s*''released''\s*,\s*''in_procurement''\s*\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp_has_inflight_procurement no longer blocks on IN (released, in_procurement). '
      'If this was narrowed or widened deliberately, update this assertion with it.';
  END IF;

  -- ---------------------------------------------------------------
  -- 8. NULL-safety on planning_stage in both release gates.
  --
  --    planning_stage is nullable (20260802 leaves it NULL where no ceiling
  --    qualified). A bare `<>` or `IN` against NULL yields NULL, which plpgsql
  --    treats as false -- so the guard would not fire and the lot would be
  --    released or EPA-flagged on a version of unknown stage. These assertions
  --    exist because that failure is invisible in testing unless a NULL-stage
  --    version happens to be present.
  -- ---------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'release_app_lot';

  IF v_def !~ 'COALESCE\(\s*v_ver\.planning_stage\s+IN' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: release_app_lot does not COALESCE the planning_stage test. '
      'A NULL stage would make the release gate fail OPEN.';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'authorize_epa_lot';

  IF v_def !~ 'planning_stage\s+IS\s+DISTINCT\s+FROM\s+''indicative''' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: authorize_epa_lot does not use IS DISTINCT FROM on planning_stage. '
      'A NULL stage would let EPA be authorized on a version of unknown stage.';
  END IF;

  -- ---------------------------------------------------------------
  -- 9. finalize_app gates on composition, not on release.
  -- ---------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'finalize_app';

  IF v_def !~ 'status\s*=\s*''draft''' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: finalize_app no longer counts draft lots. It must block on '
      'composition (status = draft), not on release.';
  END IF;
END $$;

SELECT 'PASS: 20260810_lot_two_gate_model' AS result;
