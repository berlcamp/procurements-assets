-- Assertions for 20260812_planning_rounds.sql
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/verify/20260812_planning_rounds.sql
-- The trailing SELECT prints PASS even after the DO block aborts, so without
-- ON_ERROR_STOP you MUST read the whole output.

DO $$
DECLARE
  v_src   TEXT;
  v_name  TEXT;
  v_n     INTEGER;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. Tables and RLS
  -- ---------------------------------------------------------------
  FOR v_name IN SELECT unnest(ARRAY['planning_rounds','planning_round_offices'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'procurements' AND table_name = v_name
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: procurements.% missing', v_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'procurements' AND c.relname = v_name AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: RLS not enabled on procurements.%', v_name;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 2. Functions
  -- ---------------------------------------------------------------
  FOR v_name IN SELECT unnest(ARRAY['open_planning_round','close_planning_round',
                                    'sync_planning_round_office_status'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'procurements' AND p.proname = v_name
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %() missing', v_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements' AND c.relname = 'ppmps'
       AND t.tgname = 'trg_sync_planning_round_office_status'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_sync_planning_round_office_status not on ppmps';
  END IF;

  -- ---------------------------------------------------------------
  -- 3. *** THE RUNTIME-ONLY DEFECT ***
  --
  --    procurements.user_profiles has NO user_id column -- its PK IS the
  --    auth.users id. plpgsql does not resolve column names at CREATE time, so
  --    `up.user_id` in the notification INSERT would create cleanly and then
  --    raise the first time anyone opened a round, aborting the whole campaign.
  --    The identical defect reached Task 9. Nothing but an assertion catches it
  --    before a user does.
  -- ---------------------------------------------------------------
  --    COMMENTS ARE STRIPPED FIRST. The function's own comment block warns
  --    about `up.user_id` by name, so matching the raw body reports a defect
  --    that is not there -- observed on the first run of this script. Both
  --    comment forms are removed, so rewriting that warning as /* */ cannot
  --    silently disable the check either.
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^\n]*', '', 'g'
         ) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'open_planning_round';

  IF v_src ~ '\mup\.user_id\M' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: open_planning_round references up.user_id. '
      'procurements.user_profiles has no user_id column -- its primary key IS the '
      'auth.users id. This raises at runtime, not at CREATE time.';
  END IF;

  IF v_src !~ 'SELECT DISTINCT up\.id' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: open_planning_round no longer selects up.id for notifications';
  END IF;

  -- Notifications must not reach soft-deleted or deactivated users.
  IF v_src !~ 'up\.deleted_at\s+IS NULL' OR v_src !~ 'up\.is_active' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: open_planning_round notification audience does not filter '
      'on up.deleted_at IS NULL AND up.is_active';
  END IF;

  -- ---------------------------------------------------------------
  -- 4. RLS write policies: top-level super-admin bypass in BOTH clauses, and
  --    WITH CHECK must repeat the permission test.
  --
  --    A policy with USING and no WITH CHECK has USING copied in implicitly;
  --    adding an explicit WITH CHECK that omits the permission block REMOVES a
  --    gate while reading as tightening. That was a live privilege escalation
  --    in Task 7, so it is asserted rather than trusted.
  --    Fails CLOSED on NULL (a policy with no WITH CHECK at all).
  -- ---------------------------------------------------------------
  FOR v_name IN SELECT unnest(ARRAY['manage_planning_rounds','manage_planning_round_offices'])
  LOOP
    SELECT qual INTO v_src FROM pg_policies
     WHERE schemaname = 'procurements' AND policyname = v_name;
    IF v_src IS NULL OR v_src !~ 'is_super_admin' THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %.USING lacks a super-admin bypass', v_name;
    END IF;
    IF v_src !~ 'has_permission' THEN
      RAISE EXCEPTION 'ASSERTION FAILED: %.USING lacks the permission test', v_name;
    END IF;

    SELECT with_check INTO v_src FROM pg_policies
     WHERE schemaname = 'procurements' AND policyname = v_name;
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'ASSERTION FAILED: % has no WITH CHECK', v_name;
    END IF;
    IF v_src !~ 'is_super_admin' THEN
      RAISE EXCEPTION
        'ASSERTION FAILED: %.WITH CHECK lacks the super-admin bypass, so a platform '
        'admin cannot INSERT (INSERT evaluates only WITH CHECK)', v_name;
    END IF;
    IF v_src !~ 'has_permission' THEN
      RAISE EXCEPTION
        'ASSERTION FAILED: %.WITH CHECK lacks the permission test -- any authenticated '
        'division user could write to this table', v_name;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 5. Permission seeded AND granted.
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM procurements.permissions WHERE code = 'planning.rounds_manage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: planning.rounds_manage not seeded';
  END IF;

  SELECT COUNT(*) INTO v_n
    FROM procurements.role_permissions rp
    JOIN procurements.permissions p ON p.id = rp.permission_id
   WHERE p.code = 'planning.rounds_manage';
  IF v_n = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: planning.rounds_manage is seeded but granted to no role';
  END IF;

  -- ---------------------------------------------------------------
  -- 6. One open round per fiscal year.
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'procurements'
       AND indexname  = 'idx_planning_rounds_one_open_per_fy'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: idx_planning_rounds_one_open_per_fy missing';
  END IF;

  -- Data-level backstop; passes vacuously on an empty table, which is fine --
  -- the index above is the real guarantee.
  SELECT COUNT(*) INTO v_n FROM (
    SELECT fiscal_year_id FROM procurements.planning_rounds
     WHERE status = 'open' AND deleted_at IS NULL
     GROUP BY fiscal_year_id HAVING COUNT(*) > 1
  ) t;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % fiscal year(s) carry more than one open round', v_n;
  END IF;
END $$;

SELECT 'PASS: 20260812_planning_rounds' AS result;
