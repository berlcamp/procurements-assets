DO $$
DECLARE
  v_src TEXT;
  v_fn  TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'approve_ppmp',
    'sync_ppmp_on_version_approve',
    'finalize_app',
    'create_ppmp_amendment',
    'create_app_amendment'
  ] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = v_fn
     LIMIT 1;

    IF v_src IS NULL THEN
      RAISE EXCEPTION 'ASSERTION FAILED: procurements.% not found', v_fn;
    END IF;

    IF v_src ~* 'indicative_final\s*=' THEN
      RAISE EXCEPTION
        'ASSERTION FAILED: % still assigns indicative_final', v_fn;
    END IF;

    IF v_src ~* 'planning_stage\s*=' THEN
      RAISE EXCEPTION
        'ASSERTION FAILED: % assigns planning_stage (must be trigger-derived only)', v_fn;
    END IF;
  END LOOP;
END $$;

SELECT 'PASS: 20260803_stop_stage_writes_from_workflow' AS result;
