-- Phase 4: Budget RPC functions
-- All monetary math happens here in PostgreSQL — never in JavaScript.

-- ============================================================
-- get_budget_summary(office_id, fiscal_year_id)
-- Returns one row per budget allocation line for the given
-- office and fiscal year with computed available balance.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.get_budget_summary(
  p_office_id       UUID,
  p_fiscal_year_id  UUID
)
RETURNS TABLE (
  allocation_id     UUID,
  fund_source_id    UUID,
  fund_source_name  TEXT,
  account_code_id   UUID,
  account_code      TEXT,
  account_name      TEXT,
  expense_class     TEXT,
  original_amount   NUMERIC(15,2),
  adjusted_amount   NUMERIC(15,2),
  obligated_amount  NUMERIC(15,2),
  disbursed_amount  NUMERIC(15,2),
  available_amount  NUMERIC(15,2),
  utilization_pct   NUMERIC(5,2),
  status            TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  -- Division isolation enforced: only return rows in caller's division
  RETURN QUERY
  SELECT
    ba.id                                                    AS allocation_id,
    fs.id                                                    AS fund_source_id,
    fs.name                                                  AS fund_source_name,
    ac.id                                                    AS account_code_id,
    ac.code                                                  AS account_code,
    ac.name                                                  AS account_name,
    ac.expense_class                                         AS expense_class,
    ba.original_amount,
    ba.adjusted_amount,
    ba.obligated_amount,
    ba.disbursed_amount,
    (ba.adjusted_amount - ba.obligated_amount)               AS available_amount,
    CASE
      WHEN ba.adjusted_amount = 0 THEN 0::NUMERIC(5,2)
      ELSE ROUND((ba.obligated_amount / ba.adjusted_amount) * 100, 2)
    END                                                      AS utilization_pct,
    ba.status
  FROM procurements.budget_allocations ba
  JOIN procurements.fund_sources  fs ON fs.id = ba.fund_source_id
  JOIN procurements.account_codes ac ON ac.id = ba.account_code_id
  WHERE ba.office_id      = p_office_id
    AND ba.fiscal_year_id = p_fiscal_year_id
    AND ba.division_id    = procurements.get_user_division_id()
    AND ba.deleted_at     IS NULL
    AND ba.status         = 'active'
  ORDER BY fs.name, ac.code;
END;
$$;

-- ============================================================
-- check_budget_availability(budget_allocation_id, amount)
-- Returns whether amount is available and the current balance.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.check_budget_availability(
  p_allocation_id  UUID,
  p_amount         NUMERIC(15,2)
)
RETURNS TABLE (
  is_available      BOOLEAN,
  available_amount  NUMERIC(15,2),
  adjusted_amount   NUMERIC(15,2),
  obligated_amount  NUMERIC(15,2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_alloc RECORD;
BEGIN
  SELECT adjusted_amount, obligated_amount
    INTO v_alloc
    FROM procurements.budget_allocations
   WHERE id          = p_allocation_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL
     AND status      = 'active';

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0::NUMERIC(15,2), 0::NUMERIC(15,2), 0::NUMERIC(15,2);
    RETURN;
  END IF;

  RETURN QUERY SELECT
    ((v_alloc.adjusted_amount - v_alloc.obligated_amount) >= p_amount),
    (v_alloc.adjusted_amount - v_alloc.obligated_amount),
    v_alloc.adjusted_amount,
    v_alloc.obligated_amount;
END;
$$;

-- ============================================================
-- approve_budget_adjustment(adjustment_id)
-- Sets status to 'approved'; trigger handles balance update.
-- Returns the updated adjustment record.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.approve_budget_adjustment(
  p_adjustment_id UUID
)
RETURNS SETOF procurements.budget_adjustments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_adj RECORD;
BEGIN
  SELECT *
    INTO v_adj
    FROM procurements.budget_adjustments
   WHERE id          = p_adjustment_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget adjustment % not found or access denied', p_adjustment_id;
  END IF;

  IF v_adj.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending adjustments can be approved (current status: %)', v_adj.status;
  END IF;

  IF NOT (
    procurements.has_permission('budget_adjustments.approve')
    OR platform.is_super_admin()
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to approve budget adjustments';
  END IF;

  UPDATE procurements.budget_adjustments
     SET status      = 'approved',
         approved_by = auth.uid(),
         approved_at = NOW(),
         updated_at  = NOW()
   WHERE id = p_adjustment_id
  RETURNING * INTO v_adj;

  RETURN NEXT v_adj;
END;
$$;

-- ============================================================
-- reject_budget_adjustment(adjustment_id, remarks)
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.reject_budget_adjustment(
  p_adjustment_id  UUID,
  p_remarks        TEXT DEFAULT NULL
)
RETURNS SETOF procurements.budget_adjustments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_adj RECORD;
BEGIN
  SELECT *
    INTO v_adj
    FROM procurements.budget_adjustments
   WHERE id          = p_adjustment_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget adjustment % not found or access denied', p_adjustment_id;
  END IF;

  IF v_adj.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending adjustments can be rejected (current status: %)', v_adj.status;
  END IF;

  IF NOT (
    procurements.has_permission('budget_adjustments.approve')
    OR platform.is_super_admin()
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to reject budget adjustments';
  END IF;

  UPDATE procurements.budget_adjustments
     SET status      = 'rejected',
         approved_by = auth.uid(),
         approved_at = NOW(),
         remarks     = COALESCE(p_remarks, remarks),
         updated_at  = NOW()
   WHERE id = p_adjustment_id
  RETURNING * INTO v_adj;

  RETURN NEXT v_adj;
END;
$$;

-- ============================================================
-- get_budget_utilization_by_office(fiscal_year_id)
-- Aggregated summary per office — used for dashboard chart.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.get_budget_utilization_by_office(
  p_fiscal_year_id UUID
)
RETURNS TABLE (
  office_id         UUID,
  office_name       TEXT,
  office_code       TEXT,
  total_adjusted    NUMERIC(15,2),
  total_obligated   NUMERIC(15,2),
  total_disbursed   NUMERIC(15,2),
  total_available   NUMERIC(15,2),
  utilization_pct   NUMERIC(5,2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.id                                                      AS office_id,
    o.name                                                    AS office_name,
    o.code                                                    AS office_code,
    SUM(ba.adjusted_amount)                                   AS total_adjusted,
    SUM(ba.obligated_amount)                                  AS total_obligated,
    SUM(ba.disbursed_amount)                                  AS total_disbursed,
    SUM(ba.adjusted_amount - ba.obligated_amount)             AS total_available,
    CASE
      WHEN SUM(ba.adjusted_amount) = 0 THEN 0::NUMERIC(5,2)
      ELSE ROUND((SUM(ba.obligated_amount) / SUM(ba.adjusted_amount)) * 100, 2)
    END                                                       AS utilization_pct
  FROM procurements.budget_allocations ba
  JOIN procurements.offices o ON o.id = ba.office_id
  WHERE ba.fiscal_year_id = p_fiscal_year_id
    AND ba.division_id    = procurements.get_user_division_id()
    AND ba.deleted_at     IS NULL
    AND ba.status         = 'active'
  GROUP BY o.id, o.name, o.code
  ORDER BY SUM(ba.adjusted_amount) DESC;
END;
$$;

-- ============================================================
-- get_budget_utilization_by_fund_source(fiscal_year_id)
-- Aggregated summary per fund source — used for reports.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.get_budget_utilization_by_fund_source(
  p_fiscal_year_id UUID
)
RETURNS TABLE (
  fund_source_id    UUID,
  fund_source_name  TEXT,
  fund_source_code  TEXT,
  total_adjusted    NUMERIC(15,2),
  total_obligated   NUMERIC(15,2),
  total_disbursed   NUMERIC(15,2),
  total_available   NUMERIC(15,2),
  utilization_pct   NUMERIC(5,2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    fs.id                                                     AS fund_source_id,
    fs.name                                                   AS fund_source_name,
    fs.code                                                   AS fund_source_code,
    SUM(ba.adjusted_amount)                                   AS total_adjusted,
    SUM(ba.obligated_amount)                                  AS total_obligated,
    SUM(ba.disbursed_amount)                                  AS total_disbursed,
    SUM(ba.adjusted_amount - ba.obligated_amount)             AS total_available,
    CASE
      WHEN SUM(ba.adjusted_amount) = 0 THEN 0::NUMERIC(5,2)
      ELSE ROUND((SUM(ba.obligated_amount) / SUM(ba.adjusted_amount)) * 100, 2)
    END                                                       AS utilization_pct
  FROM procurements.budget_allocations ba
  JOIN procurements.fund_sources fs ON fs.id = ba.fund_source_id
  WHERE ba.fiscal_year_id = p_fiscal_year_id
    AND ba.division_id    = procurements.get_user_division_id()
    AND ba.deleted_at     IS NULL
    AND ba.status         = 'active'
  GROUP BY fs.id, fs.name, fs.code
  ORDER BY SUM(ba.adjusted_amount) DESC;
END;
$$;
