-- ============================================================
-- Phase 16: Report & Dashboard RPCs
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Executive Dashboard (HOPE / Division Chief)
--    Aggregates budget, procurement, and asset summaries for
--    the division's active fiscal year.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION procurements.get_executive_dashboard(
  p_division_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_fy_id      UUID;
  v_budget     RECORD;
  v_proc       RECORD;
  v_assets     RECORD;
  v_approvals  INT;
BEGIN
  -- Get active fiscal year
  SELECT id INTO v_fy_id
  FROM procurements.fiscal_years
  WHERE is_active = true
  LIMIT 1;

  -- Budget aggregation
  SELECT
    COALESCE(SUM(adjusted_amount), 0)  AS total_adjusted,
    COALESCE(SUM(obligated_amount), 0) AS total_obligated,
    COALESCE(SUM(disbursed_amount), 0) AS total_disbursed,
    CASE WHEN COALESCE(SUM(adjusted_amount), 0) > 0
      THEN ROUND(COALESCE(SUM(obligated_amount), 0) / SUM(adjusted_amount) * 100, 1)
      ELSE 0
    END AS utilization_pct
  INTO v_budget
  FROM procurements.budget_allocations
  WHERE division_id = p_division_id
    AND fiscal_year_id = v_fy_id
    AND deleted_at IS NULL;

  -- Procurement pipeline
  SELECT
    COUNT(*)                                          AS total,
    COUNT(*) FILTER (WHERE status = 'active')         AS active,
    COUNT(*) FILTER (WHERE status = 'completed')      AS completed,
    COUNT(*) FILTER (WHERE status = 'failed')         AS failed,
    COALESCE(SUM(abc_amount), 0)                      AS total_abc,
    COALESCE(SUM(contract_amount) FILTER (WHERE status = 'completed'), 0) AS total_awarded,
    COALESCE(SUM(savings_amount) FILTER (WHERE status = 'completed'), 0)  AS total_savings
  INTO v_proc
  FROM procurements.procurement_activities
  WHERE division_id = p_division_id
    AND fiscal_year_id = v_fy_id
    AND deleted_at IS NULL;

  -- Asset summary
  SELECT
    COUNT(*) FILTER (WHERE status = 'active')                AS active_count,
    COALESCE(SUM(book_value) FILTER (WHERE status = 'active'), 0) AS total_book_value,
    COUNT(*) FILTER (WHERE status = 'for_disposal')          AS for_disposal_count
  INTO v_assets
  FROM procurements.assets
  WHERE division_id = p_division_id
    AND deleted_at IS NULL;

  -- Pending approvals count (notifications with type = 'approval' unread)
  SELECT COUNT(*)
  INTO v_approvals
  FROM procurements.notifications n
  JOIN procurements.user_profiles up ON up.id = n.user_id
  WHERE up.division_id = p_division_id
    AND n.type = 'approval'
    AND n.is_read = false;

  RETURN json_build_object(
    'budget_total_adjusted',   v_budget.total_adjusted,
    'budget_total_obligated',  v_budget.total_obligated,
    'budget_total_disbursed',  v_budget.total_disbursed,
    'budget_utilization_pct',  v_budget.utilization_pct,
    'procurement_total',       v_proc.total,
    'procurement_active',      v_proc.active,
    'procurement_completed',   v_proc.completed,
    'procurement_failed',      v_proc.failed,
    'procurement_total_abc',   v_proc.total_abc,
    'procurement_total_awarded', v_proc.total_awarded,
    'procurement_total_savings', v_proc.total_savings,
    'assets_active_count',     v_assets.active_count,
    'assets_total_book_value', v_assets.total_book_value,
    'assets_for_disposal',     v_assets.for_disposal_count,
    'pending_approvals_count', v_approvals
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Compliance Summary (Auditor / HOPE)
--    Checks document completeness, procurement timeliness,
--    asset accountability, and OBR certification.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION procurements.get_compliance_summary(
  p_division_id    UUID,
  p_fiscal_year_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_total_proc      INT;
  v_with_docs       INT;
  v_completed       INT;
  v_total_assets    INT;
  v_with_par_ics    INT;
  v_obr_total       INT;
  v_obr_certified   INT;
  v_compliance_score NUMERIC(5,1);
  v_score_parts     INT := 0;
  v_score_sum       NUMERIC := 0;
BEGIN
  -- Procurement document completeness
  -- A completed procurement should have: bac_resolution, noa, signed_contract, ntp
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE
      status = 'completed'
      AND bac_resolution_file_url IS NOT NULL
      AND noa_file_url IS NOT NULL
      AND signed_contract_file_url IS NOT NULL
      AND ntp_file_url IS NOT NULL
    )
  INTO v_total_proc, v_completed, v_with_docs
  FROM procurements.procurement_activities
  WHERE division_id = p_division_id
    AND fiscal_year_id = p_fiscal_year_id
    AND deleted_at IS NULL;

  -- Asset accountability: active assets should have a current PAR/ICS assignment
  SELECT COUNT(*)
  INTO v_total_assets
  FROM procurements.assets
  WHERE division_id = p_division_id
    AND status = 'active'
    AND deleted_at IS NULL;

  SELECT COUNT(DISTINCT a.id)
  INTO v_with_par_ics
  FROM procurements.assets a
  JOIN procurements.asset_assignments aa ON aa.asset_id = a.id AND aa.is_current = true
  WHERE a.division_id = p_division_id
    AND a.status = 'active'
    AND a.deleted_at IS NULL;

  -- OBR certification
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status IN ('certified', 'obligated'))
  INTO v_obr_total, v_obr_certified
  FROM procurements.obligation_requests obr
  JOIN procurements.purchase_requests pr ON pr.id = obr.purchase_request_id
  WHERE pr.division_id = p_division_id
    AND pr.fiscal_year_id = p_fiscal_year_id
    AND obr.deleted_at IS NULL;

  -- Calculate weighted compliance score (average of 3 components)
  -- Component 1: Document completeness (completed procurements with all docs)
  IF v_completed > 0 THEN
    v_score_sum := v_score_sum + (v_with_docs::NUMERIC / v_completed * 100);
    v_score_parts := v_score_parts + 1;
  END IF;

  -- Component 2: Asset accountability (assets with PAR/ICS)
  IF v_total_assets > 0 THEN
    v_score_sum := v_score_sum + (v_with_par_ics::NUMERIC / v_total_assets * 100);
    v_score_parts := v_score_parts + 1;
  END IF;

  -- Component 3: OBR certification rate
  IF v_obr_total > 0 THEN
    v_score_sum := v_score_sum + (v_obr_certified::NUMERIC / v_obr_total * 100);
    v_score_parts := v_score_parts + 1;
  END IF;

  IF v_score_parts > 0 THEN
    v_compliance_score := ROUND(v_score_sum / v_score_parts, 1);
  ELSE
    v_compliance_score := 100.0; -- No data = nothing to comply with
  END IF;

  RETURN json_build_object(
    'total_procurements',    v_total_proc,
    'completed_procurements', v_completed,
    'with_complete_docs',    v_with_docs,
    'missing_docs_count',    GREATEST(v_completed - v_with_docs, 0),
    'total_assets',          v_total_assets,
    'assets_with_par_ics',   v_with_par_ics,
    'assets_without_par_ics', GREATEST(v_total_assets - v_with_par_ics, 0),
    'obr_total',             v_obr_total,
    'obr_certified',         v_obr_certified,
    'obr_pending',           GREATEST(v_obr_total - v_obr_certified, 0),
    'compliance_score_pct',  v_compliance_score
  );
END;
$$;
