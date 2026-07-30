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
END $$;

SELECT 'PASS: 20260801_budget_ceilings' AS result;
