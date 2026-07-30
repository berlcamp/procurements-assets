-- Assertions for 20260801_budget_ceilings.sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'procurements' AND table_name = 'budget_ceilings'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: procurements.budget_ceilings does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements' AND c.relname = 'budget_ceilings' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: RLS is not enabled on budget_ceilings';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'fiscal_year_planning_stage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: fiscal_year_planning_stage() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM procurements.permissions WHERE code = 'budget.ceilings_manage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: budget.ceilings_manage permission not seeded';
  END IF;

  -- Only one authoritative ceiling per fiscal year + stage
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'procurements'
       AND indexname = 'idx_ceilings_one_authoritative_per_stage'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: authoritative-ceiling unique index missing';
  END IF;

  -- Behavioral: manage_ceilings policy WITH CHECK must include is_super_admin
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'budget_ceilings'
       AND policyname = 'manage_ceilings'
       AND with_check LIKE '%is_super_admin%'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: manage_ceilings WITH CHECK missing is_super_admin bypass';
  END IF;

  -- Behavioral: stage mapping functions work correctly
  IF procurements.ceiling_stage_to_planning_stage('gaa') != 'final' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ceiling_stage_to_planning_stage(gaa) should return final';
  END IF;

  IF procurements.ceiling_stage_to_planning_stage('indicative') != 'indicative' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ceiling_stage_to_planning_stage(indicative) should return indicative';
  END IF;
END $$;

SELECT 'PASS: 20260801_budget_ceilings' AS result;
