-- Phase 4: Budget test data seed
-- Creates a reusable function to seed FY 2026 budget data for a given division.
-- Safe to call multiple times — uses ON CONFLICT DO NOTHING.
--
-- Usage (run in Supabase SQL Editor, replacing the UUID):
--   SELECT procurements.seed_budget_fy2026('<division_id_uuid>');

CREATE OR REPLACE FUNCTION procurements.seed_budget_fy2026(p_division_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_fy_id         UUID;
  v_finance_id    UUID;
  v_admin_id      UUID;
  v_gf_id         UUID;
  v_sef_id        UUID;
  v_mooe_ac_id    UUID;
  v_supplies_id   UUID;
BEGIN
  -- Verify division exists
  IF NOT EXISTS (SELECT 1 FROM platform.divisions WHERE id = p_division_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Division % not found', p_division_id;
  END IF;

  -- ────────────────────────────────────────
  -- 1. Ensure FY 2026 exists
  -- ────────────────────────────────────────
  INSERT INTO procurements.fiscal_years (division_id, year, is_active, status, start_date, end_date)
  VALUES (p_division_id, 2026, true, 'open', '2026-01-01', '2026-12-31')
  ON CONFLICT (division_id, year) DO NOTHING;

  SELECT id INTO v_fy_id
  FROM procurements.fiscal_years
  WHERE division_id = p_division_id AND year = 2026;

  -- ────────────────────────────────────────
  -- 2. Pick two offices from this division
  -- ────────────────────────────────────────
  SELECT id INTO v_finance_id
  FROM procurements.offices
  WHERE division_id = p_division_id
    AND deleted_at IS NULL
  ORDER BY name
  LIMIT 1;

  SELECT id INTO v_admin_id
  FROM procurements.offices
  WHERE division_id = p_division_id
    AND deleted_at IS NULL
    AND id <> v_finance_id
  ORDER BY name
  LIMIT 1;

  IF v_finance_id IS NULL THEN
    RAISE NOTICE 'No offices found for division %. Run seed_standard_offices() first.', p_division_id;
    RETURN;
  END IF;

  -- ────────────────────────────────────────
  -- 3. Resolve fund sources
  -- ────────────────────────────────────────
  SELECT id INTO v_gf_id  FROM procurements.fund_sources WHERE code = 'GF'   LIMIT 1;
  SELECT id INTO v_sef_id FROM procurements.fund_sources WHERE code = 'SEF'  LIMIT 1;

  IF v_gf_id IS NULL OR v_sef_id IS NULL THEN
    RAISE NOTICE 'Fund sources GF/SEF not found — skipping budget seed.';
    RETURN;
  END IF;

  -- ────────────────────────────────────────
  -- 4. Resolve account codes
  -- ────────────────────────────────────────
  SELECT id INTO v_mooe_ac_id
  FROM procurements.account_codes
  WHERE code = '5020402000' AND is_active = true  -- Electricity Expenses
  LIMIT 1;

  SELECT id INTO v_supplies_id
  FROM procurements.account_codes
  WHERE code = '5020302000' AND is_active = true  -- Office Supplies Expense
  LIMIT 1;

  IF v_mooe_ac_id IS NULL OR v_supplies_id IS NULL THEN
    RAISE NOTICE 'Account codes not found — skipping budget seed.';
    RETURN;
  END IF;

  -- ────────────────────────────────────────
  -- 5. Seed allocations
  -- ────────────────────────────────────────

  -- Office 1 / GF / Electricity
  INSERT INTO procurements.budget_allocations (
    division_id, fiscal_year_id, office_id, fund_source_id, account_code_id,
    original_amount, adjusted_amount, obligated_amount, disbursed_amount,
    description
  )
  VALUES (
    p_division_id, v_fy_id, v_finance_id, v_gf_id, v_mooe_ac_id,
    500000.00, 500000.00, 0.00, 0.00,
    'General Fund allocation for electricity (FY 2026)'
  )
  ON CONFLICT (fiscal_year_id, office_id, fund_source_id, account_code_id) DO NOTHING;

  -- Office 1 / SEF / Supplies
  INSERT INTO procurements.budget_allocations (
    division_id, fiscal_year_id, office_id, fund_source_id, account_code_id,
    original_amount, adjusted_amount, obligated_amount, disbursed_amount,
    description
  )
  VALUES (
    p_division_id, v_fy_id, v_finance_id, v_sef_id, v_supplies_id,
    250000.00, 250000.00, 0.00, 0.00,
    'SEF allocation for office supplies (FY 2026)'
  )
  ON CONFLICT (fiscal_year_id, office_id, fund_source_id, account_code_id) DO NOTHING;

  -- Office 2 / GF / Supplies (only if second office exists)
  IF v_admin_id IS NOT NULL THEN
    INSERT INTO procurements.budget_allocations (
      division_id, fiscal_year_id, office_id, fund_source_id, account_code_id,
      original_amount, adjusted_amount, obligated_amount, disbursed_amount,
      description
    )
    VALUES (
      p_division_id, v_fy_id, v_admin_id, v_gf_id, v_supplies_id,
      150000.00, 150000.00, 0.00, 0.00,
      'General Fund allocation for office supplies (FY 2026)'
    )
    ON CONFLICT (fiscal_year_id, office_id, fund_source_id, account_code_id) DO NOTHING;
  END IF;

  RAISE NOTICE 'Budget seed for FY 2026 complete for division %.', p_division_id;
END;
$$;
