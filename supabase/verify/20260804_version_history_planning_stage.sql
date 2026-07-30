DO $$
DECLARE
  v_oid    OID;
  v_defn   TEXT;
BEGIN
  SELECT p.oid
    INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements'
     AND p.proname  = 'get_ppmp_version_history';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: procurements.get_ppmp_version_history does not exist';
  END IF;

  v_defn := pg_get_functiondef(v_oid);

  IF v_defn NOT LIKE '%planning_stage%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: get_ppmp_version_history definition does not reference planning_stage';
  END IF;

  IF v_defn NOT LIKE '%budget_ceiling_id%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: get_ppmp_version_history definition does not reference budget_ceiling_id';
  END IF;

  IF v_defn NOT LIKE '%indicative_final%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: get_ppmp_version_history definition dropped indicative_final — it must be kept, only deprecated';
  END IF;
END $$;

SELECT 'PASS: 20260804_version_history_planning_stage' AS result;
