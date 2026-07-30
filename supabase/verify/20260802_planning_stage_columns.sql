DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(t || '.' || c, ', ')
    INTO v_missing
    FROM (VALUES
      ('ppmp_versions','planning_stage'),
      ('ppmp_versions','budget_ceiling_id'),
      ('app_versions','planning_stage'),
      ('app_versions','budget_ceiling_id')
    ) AS x(t, c)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'procurements'
        AND table_name = x.t
        AND column_name = x.c
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: missing columns: %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_ppmp_version_planning_stage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_ppmp_version_planning_stage missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_app_version_planning_stage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_app_version_planning_stage missing';
  END IF;

  -- Backfill must leave no NULLs
  IF EXISTS (SELECT 1 FROM procurements.ppmp_versions WHERE planning_stage IS NULL) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp_versions.planning_stage has NULLs after backfill';
  END IF;

  IF EXISTS (SELECT 1 FROM procurements.app_versions WHERE planning_stage IS NULL) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_versions.planning_stage has NULLs after backfill';
  END IF;
END $$;

SELECT 'PASS: 20260802_planning_stage_columns' AS result;
