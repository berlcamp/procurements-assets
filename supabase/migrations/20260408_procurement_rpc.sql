-- Phase 7: Procurement Core — RPC functions

-- ============================================================
-- generate_pr_number(p_office_id, p_fiscal_year_id, p_division_id)
-- Returns: PR-{OFFICE_CODE}-{YEAR}-{NNNN}
-- Uses sequence_counters table (counter_type = 'pr'), atomic increment.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.generate_pr_number(
  p_office_id      UUID,
  p_fiscal_year_id UUID,
  p_division_id    UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_office_code TEXT;
  v_year        INTEGER;
  v_next        INTEGER;
BEGIN
  SELECT code INTO v_office_code
    FROM procurements.offices
   WHERE id = p_office_id;

  SELECT year INTO v_year
    FROM procurements.fiscal_years
   WHERE id = p_fiscal_year_id;

  UPDATE procurements.sequence_counters
     SET last_value = last_value + 1
   WHERE division_id  = p_division_id
     AND office_id    = p_office_id
     AND counter_type = 'pr'
     AND fiscal_year  = v_year
  RETURNING last_value INTO v_next;

  IF NOT FOUND THEN
    INSERT INTO procurements.sequence_counters
      (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
    VALUES
      (p_division_id, p_office_id, 'pr', v_year, 1, 'PR')
    RETURNING last_value INTO v_next;
  END IF;

  RETURN 'PR-' || COALESCE(v_office_code, 'DIV') || '-' || v_year || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

-- ============================================================
-- generate_obr_number(p_office_id, p_fiscal_year_id, p_division_id)
-- Returns: OBR-{OFFICE_CODE}-{YEAR}-{NNNN}
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.generate_obr_number(
  p_office_id      UUID,
  p_fiscal_year_id UUID,
  p_division_id    UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_office_code TEXT;
  v_year        INTEGER;
  v_next        INTEGER;
BEGIN
  SELECT code INTO v_office_code
    FROM procurements.offices
   WHERE id = p_office_id;

  SELECT year INTO v_year
    FROM procurements.fiscal_years
   WHERE id = p_fiscal_year_id;

  UPDATE procurements.sequence_counters
     SET last_value = last_value + 1
   WHERE division_id  = p_division_id
     AND office_id    = p_office_id
     AND counter_type = 'obr'
     AND fiscal_year  = v_year
  RETURNING last_value INTO v_next;

  IF NOT FOUND THEN
    INSERT INTO procurements.sequence_counters
      (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
    VALUES
      (p_division_id, p_office_id, 'obr', v_year, 1, 'OBR')
    RETURNING last_value INTO v_next;
  END IF;

  RETURN 'OBR-' || COALESCE(v_office_code, 'DIV') || '-' || v_year || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

-- ============================================================
-- create_purchase_request(...)
-- End User creates a PR for an APP item.
-- Validates: permission, APP approved, office ownership (for End Users),
--            total <= APP item budget, budget availability.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.create_purchase_request(
  p_office_id      UUID,
  p_app_item_id    UUID,
  p_purpose        TEXT,
  p_fiscal_year_id UUID,
  p_items          JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_division_id  UUID;
  v_user_office  UUID;
  v_app_item     RECORD;
  v_budget_alloc RECORD;
  v_pr_id        UUID;
  v_pr_number    TEXT;
  v_total_cost   NUMERIC := 0;
  v_item         JSONB;
  v_item_number  INTEGER := 0;
  v_fund_src_id  UUID;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('pr.create') THEN
    RAISE EXCEPTION 'Insufficient permissions to create Purchase Requests';
  END IF;

  -- Get caller's profile
  SELECT division_id, office_id
    INTO v_division_id, v_user_office
    FROM procurements.user_profiles
   WHERE id = v_user_id
     AND deleted_at IS NULL;

  IF v_division_id IS NULL THEN
    RAISE EXCEPTION 'User has no division assigned';
  END IF;

  -- Get and validate APP item (must be in approved APP within caller's division)
  SELECT
    ai.*,
    a.status            AS app_status,
    a.indicative_final  AS app_indicative_final
  INTO v_app_item
  FROM procurements.app_items ai
  JOIN procurements.apps a ON a.id = ai.app_id
  WHERE ai.id          = p_app_item_id
    AND ai.deleted_at  IS NULL
    AND a.deleted_at   IS NULL
    AND a.division_id  = v_division_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP item % not found or not accessible', p_app_item_id;
  END IF;

  -- APP must be in approved state
  IF v_app_item.app_status NOT IN ('approved', 'posted') THEN
    RAISE EXCEPTION 'Purchase Requests can only be created from an approved APP (current APP status: %)',
      v_app_item.app_status;
  END IF;

  -- Office ownership check:
  -- Roles without ppmp.view_all can only PR for items from their own office
  IF NOT procurements.has_permission('ppmp.view_all') THEN
    IF v_app_item.source_office_id IS NOT NULL
       AND v_app_item.source_office_id <> v_user_office THEN
      RAISE EXCEPTION 'You can only create Purchase Requests for APP items originating from your own office';
    END IF;
  END IF;

  -- Items must not be empty
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  -- Compute total estimated cost
  SELECT COALESCE(SUM(
    (item->>'quantity')::NUMERIC * (item->>'estimated_unit_cost')::NUMERIC
  ), 0)
  INTO v_total_cost
  FROM jsonb_array_elements(p_items) AS item;

  -- Validate total does not exceed APP item budget
  IF v_total_cost > v_app_item.estimated_budget::NUMERIC THEN
    RAISE EXCEPTION 'Total estimated cost (₱%) exceeds APP item estimated budget (₱%)',
      v_total_cost, v_app_item.estimated_budget;
  END IF;

  -- Derive fund_source_id from budget_allocation if linked
  IF v_app_item.budget_allocation_id IS NOT NULL THEN
    SELECT ba.fund_source_id, ba.adjusted_amount, ba.obligated_amount
      INTO v_budget_alloc
      FROM procurements.budget_allocations ba
     WHERE ba.id = v_app_item.budget_allocation_id
       AND ba.deleted_at IS NULL;

    IF FOUND THEN
      v_fund_src_id := v_budget_alloc.fund_source_id;
      -- Validate available balance
      IF (v_budget_alloc.adjusted_amount::NUMERIC - v_budget_alloc.obligated_amount::NUMERIC) < v_total_cost THEN
        RAISE EXCEPTION 'Insufficient budget. Available: ₱%, Requested: ₱%',
          (v_budget_alloc.adjusted_amount::NUMERIC - v_budget_alloc.obligated_amount::NUMERIC),
          v_total_cost;
      END IF;
    END IF;
  END IF;

  -- Generate PR number
  v_pr_number := procurements.generate_pr_number(p_office_id, p_fiscal_year_id, v_division_id);

  -- Insert purchase request
  INSERT INTO procurements.purchase_requests (
    division_id, pr_number, office_id, fiscal_year_id, purpose,
    requested_by, requested_at,
    fund_source_id, budget_allocation_id,
    ppmp_item_id, app_item_id, lot_id,
    total_estimated_cost, status, created_by
  ) VALUES (
    v_division_id, v_pr_number, p_office_id, p_fiscal_year_id, p_purpose,
    v_user_id, NOW(),
    v_fund_src_id, v_app_item.budget_allocation_id,
    v_app_item.source_ppmp_lot_id, p_app_item_id, v_app_item.lot_id,
    v_total_cost, 'draft', v_user_id
  )
  RETURNING id INTO v_pr_id;

  -- Insert line items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_number := v_item_number + 1;
    INSERT INTO procurements.pr_items (
      purchase_request_id, item_number, description, unit,
      quantity, estimated_unit_cost,
      ppmp_item_id, app_item_id, remarks, office_id
    ) VALUES (
      v_pr_id, v_item_number,
      v_item->>'description',
      v_item->>'unit',
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'estimated_unit_cost')::NUMERIC,
      v_app_item.source_ppmp_lot_id, p_app_item_id,
      NULLIF(v_item->>'remarks', ''),
      p_office_id
    );
  END LOOP;

  RETURN v_pr_id;
END;
$$;

-- ============================================================
-- submit_purchase_request(p_pr_id)
-- Advances PR from draft → submitted.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.submit_purchase_request(
  p_pr_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_pr RECORD;
BEGIN
  SELECT * INTO v_pr
    FROM procurements.purchase_requests
   WHERE id          = p_pr_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Request % not found', p_pr_id;
  END IF;

  IF v_pr.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft PRs can be submitted (current status: %)', v_pr.status;
  END IF;

  -- Caller must be owner or have pr.submit permission
  IF v_pr.created_by <> auth.uid()
     AND NOT procurements.has_permission('pr.submit') THEN
    RAISE EXCEPTION 'Insufficient permissions to submit this Purchase Request';
  END IF;

  -- Must have at least one item
  IF NOT EXISTS (
    SELECT 1 FROM procurements.pr_items
    WHERE purchase_request_id = p_pr_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot submit a Purchase Request with no line items';
  END IF;

  UPDATE procurements.purchase_requests
     SET status      = 'submitted',
         updated_at  = NOW()
   WHERE id = p_pr_id;
END;
$$;

-- ============================================================
-- certify_budget_availability(p_pr_id, p_remarks)
-- Budget Officer certifies fund availability.
-- Creates OBR (pending → certified) which triggers budget debit.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.certify_budget_availability(
  p_pr_id   UUID,
  p_remarks TEXT DEFAULT NULL
)
RETURNS TEXT   -- Returns the generated OBR number
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_pr         RECORD;
  v_budget     RECORD;
  v_obr_id     UUID;
  v_obr_number TEXT;
  v_available  NUMERIC;
BEGIN
  IF NOT procurements.has_permission('pr.certify') THEN
    RAISE EXCEPTION 'Insufficient permissions to certify budget availability';
  END IF;

  SELECT * INTO v_pr
    FROM procurements.purchase_requests
   WHERE id          = p_pr_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Request % not found', p_pr_id;
  END IF;

  IF v_pr.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only submitted PRs can be certified (current status: %)', v_pr.status;
  END IF;

  -- Re-validate budget availability at time of certification
  IF v_pr.budget_allocation_id IS NOT NULL THEN
    SELECT adjusted_amount::NUMERIC - obligated_amount::NUMERIC
      INTO v_available
      FROM procurements.budget_allocations
     WHERE id = v_pr.budget_allocation_id
       AND deleted_at IS NULL;

    IF COALESCE(v_available, 0) < v_pr.total_estimated_cost THEN
      RAISE EXCEPTION 'Insufficient budget at time of certification. Available: ₱%, Required: ₱%',
        COALESCE(v_available, 0), v_pr.total_estimated_cost;
    END IF;
  END IF;

  -- Generate OBR number
  v_obr_number := procurements.generate_obr_number(v_pr.office_id, v_pr.fiscal_year_id, v_pr.division_id);

  -- Insert OBR as pending first (trigger fires on status change to certified)
  INSERT INTO procurements.obligation_requests (
    division_id, obr_number, purchase_request_id,
    budget_allocation_id, office_id,
    amount, status, created_by
  ) VALUES (
    v_pr.division_id, v_obr_number, p_pr_id,
    v_pr.budget_allocation_id, v_pr.office_id,
    v_pr.total_estimated_cost, 'pending', auth.uid()
  )
  RETURNING id INTO v_obr_id;

  -- Transition OBR to certified — this fires trg_obr_budget_sync which debits the allocation
  UPDATE procurements.obligation_requests
     SET status       = 'certified',
         certified_by = auth.uid(),
         certified_at = NOW(),
         remarks      = p_remarks,
         updated_at   = NOW()
   WHERE id = v_obr_id;

  -- Advance PR to budget_certified
  UPDATE procurements.purchase_requests
     SET status                = 'budget_certified',
         budget_certified_by   = auth.uid(),
         budget_certified_at   = NOW(),
         updated_at            = NOW()
   WHERE id = p_pr_id;

  RETURN v_obr_number;
END;
$$;

-- ============================================================
-- approve_purchase_request(p_pr_id, p_remarks)
-- HOPE / authorized approver advances budget_certified → approved.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.approve_purchase_request(
  p_pr_id   UUID,
  p_remarks TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_pr RECORD;
BEGIN
  IF NOT procurements.has_permission('pr.approve') THEN
    RAISE EXCEPTION 'Insufficient permissions to approve Purchase Requests';
  END IF;

  SELECT * INTO v_pr
    FROM procurements.purchase_requests
   WHERE id          = p_pr_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Request % not found', p_pr_id;
  END IF;

  IF v_pr.status <> 'budget_certified' THEN
    RAISE EXCEPTION 'Only budget-certified PRs can be approved (current status: %)', v_pr.status;
  END IF;

  UPDATE procurements.purchase_requests
     SET status      = 'approved',
         approved_by = auth.uid(),
         approved_at = NOW(),
         updated_at  = NOW()
   WHERE id = p_pr_id;
END;
$$;

-- ============================================================
-- return_pr_to_end_user(p_pr_id, p_reason)
-- Budget Officer or approver returns PR to draft for revision.
-- If a certified OBR exists, its obligation is reversed first.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.return_pr_to_end_user(
  p_pr_id  UUID,
  p_reason TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_pr RECORD;
BEGIN
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 5 THEN
    RAISE EXCEPTION 'A reason of at least 5 characters is required to return a PR';
  END IF;

  IF NOT (procurements.has_permission('pr.certify') OR procurements.has_permission('pr.approve')) THEN
    RAISE EXCEPTION 'Insufficient permissions to return this Purchase Request';
  END IF;

  SELECT * INTO v_pr
    FROM procurements.purchase_requests
   WHERE id          = p_pr_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Request % not found', p_pr_id;
  END IF;

  IF v_pr.status NOT IN ('submitted', 'budget_certified') THEN
    RAISE EXCEPTION 'Cannot return a PR in status %', v_pr.status;
  END IF;

  -- If OBR was certified, cancel it (trigger reverses the budget debit)
  IF v_pr.status = 'budget_certified' THEN
    UPDATE procurements.obligation_requests
       SET status     = 'cancelled',
           updated_at = NOW()
     WHERE purchase_request_id = p_pr_id
       AND status               IN ('pending', 'certified')
       AND deleted_at           IS NULL;
  END IF;

  UPDATE procurements.purchase_requests
     SET status                  = 'draft',
         budget_certified_by     = NULL,
         budget_certified_at     = NULL,
         cancellation_reason     = p_reason,
         updated_at              = NOW()
   WHERE id = p_pr_id;
END;
$$;

-- ============================================================
-- cancel_purchase_request(p_pr_id, p_reason)
-- Cancels a PR. If OBR exists and is certified, reverses the debit.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.cancel_purchase_request(
  p_pr_id  UUID,
  p_reason TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_pr RECORD;
BEGIN
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 5 THEN
    RAISE EXCEPTION 'A cancellation reason of at least 5 characters is required';
  END IF;

  SELECT * INTO v_pr
    FROM procurements.purchase_requests
   WHERE id          = p_pr_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Request % not found', p_pr_id;
  END IF;

  IF v_pr.status IN ('in_procurement', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot cancel a PR in status %', v_pr.status;
  END IF;

  -- Only owner can cancel their own draft; certified/approved needs cancel permission
  IF v_pr.status = 'draft' THEN
    IF v_pr.created_by <> auth.uid()
       AND NOT procurements.has_permission('pr.cancel') THEN
      RAISE EXCEPTION 'Insufficient permissions to cancel this Purchase Request';
    END IF;
  ELSE
    IF NOT procurements.has_permission('pr.cancel') THEN
      RAISE EXCEPTION 'Insufficient permissions to cancel this Purchase Request';
    END IF;
  END IF;

  -- Reverse OBR obligation if PR was budget-certified
  IF v_pr.status IN ('budget_certified', 'approved') THEN
    UPDATE procurements.obligation_requests
       SET status     = 'cancelled',
           updated_at = NOW()
     WHERE purchase_request_id = p_pr_id
       AND status               IN ('pending', 'certified', 'obligated')
       AND deleted_at           IS NULL;
  END IF;

  UPDATE procurements.purchase_requests
     SET status              = 'cancelled',
         cancellation_reason = p_reason,
         cancelled_by        = auth.uid(),
         cancelled_at        = NOW(),
         updated_at          = NOW()
   WHERE id = p_pr_id;
END;
$$;

-- ============================================================
-- update_pr_items(p_pr_id, p_items jsonb)
-- Replaces line items on a draft PR (soft-delete old, insert new).
-- Recalculates total_estimated_cost on the parent PR.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.update_pr_items(
  p_pr_id  UUID,
  p_items  JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_pr          RECORD;
  v_item        JSONB;
  v_item_number INTEGER := 0;
  v_total_cost  NUMERIC := 0;
BEGIN
  SELECT * INTO v_pr
    FROM procurements.purchase_requests
   WHERE id          = p_pr_id
     AND created_by  = auth.uid()
     AND division_id = procurements.get_user_division_id()
     AND status      = 'draft'
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PR % not found or is not an editable draft', p_pr_id;
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  -- Soft-delete all existing items
  UPDATE procurements.pr_items
     SET deleted_at = NOW()
   WHERE purchase_request_id = p_pr_id
     AND deleted_at IS NULL;

  -- Insert new items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_number := v_item_number + 1;
    INSERT INTO procurements.pr_items (
      purchase_request_id, item_number, description, unit,
      quantity, estimated_unit_cost,
      ppmp_item_id, app_item_id, remarks, office_id
    ) VALUES (
      p_pr_id, v_item_number,
      v_item->>'description', v_item->>'unit',
      (v_item->>'quantity')::NUMERIC, (v_item->>'estimated_unit_cost')::NUMERIC,
      v_pr.ppmp_item_id, v_pr.app_item_id,
      NULLIF(v_item->>'remarks', ''),
      v_pr.office_id
    );

    v_total_cost := v_total_cost
      + (v_item->>'quantity')::NUMERIC * (v_item->>'estimated_unit_cost')::NUMERIC;
  END LOOP;

  -- Recalculate parent total
  UPDATE procurements.purchase_requests
     SET total_estimated_cost = v_total_cost,
         updated_at           = NOW()
   WHERE id = p_pr_id;
END;
$$;

-- ============================================================
-- check_split_contract(p_office_id, p_category, p_amount)
-- Advisory warning: returns whether cumulative PRs suggest contract splitting.
-- RA 12009 SVP threshold (goods/services): ₱1,000,000 per item per year.
-- Returns JSONB: { warning, cumulative_amount, threshold, pr_count }
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.check_split_contract(
  p_office_id   UUID,
  p_category    TEXT,    -- project_type: 'goods', 'infrastructure', 'consulting_services'
  p_amount      NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_threshold     NUMERIC;
  v_cumulative    NUMERIC := 0;
  v_pr_count      INTEGER := 0;
  v_division_id   UUID := procurements.get_user_division_id();
  v_fy_id         UUID;
BEGIN
  -- Determine SVP threshold by category (RA 12009 Schedule of Thresholds for NGAs)
  CASE p_category
    WHEN 'infrastructure' THEN v_threshold := 5000000;   -- ₱5M for infrastructure
    WHEN 'consulting_services' THEN v_threshold := 1000000;  -- ₱1M for consulting
    ELSE v_threshold := 1000000;                          -- ₱1M for goods
  END CASE;

  -- Get current fiscal year
  SELECT id INTO v_fy_id
    FROM procurements.fiscal_years
   WHERE division_id = v_division_id
     AND status = 'active'
   LIMIT 1;

  -- Sum recent PRs from same office for similar items (same category via APP item)
  IF v_fy_id IS NOT NULL THEN
    SELECT COALESCE(SUM(pr.total_estimated_cost), 0), COUNT(*)
      INTO v_cumulative, v_pr_count
      FROM procurements.purchase_requests pr
      JOIN procurements.app_items ai ON ai.id = pr.app_item_id
     WHERE pr.office_id      = p_office_id
       AND pr.fiscal_year_id = v_fy_id
       AND pr.division_id    = v_division_id
       AND pr.status         NOT IN ('cancelled')
       AND pr.deleted_at     IS NULL
       AND ai.project_type   = p_category;
  END IF;

  v_cumulative := v_cumulative + p_amount;

  RETURN jsonb_build_object(
    'warning',           v_cumulative >= v_threshold,
    'cumulative_amount', v_cumulative,
    'threshold',         v_threshold,
    'pr_count',          v_pr_count
  );
END;
$$;

-- ============================================================
-- get_pr_summary(p_fiscal_year_id)
-- Dashboard stats for the Procurement module.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.get_pr_summary(
  p_fiscal_year_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_division_id UUID := procurements.get_user_division_id();
  v_result      JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_prs',           COUNT(*),
    'draft_prs',           COUNT(*) FILTER (WHERE status = 'draft'),
    'pending_certification', COUNT(*) FILTER (WHERE status = 'submitted'),
    'pending_approval',    COUNT(*) FILTER (WHERE status = 'budget_certified'),
    'in_procurement',      COUNT(*) FILTER (WHERE status = 'in_procurement'),
    'completed_prs',       COUNT(*) FILTER (WHERE status = 'completed'),
    'total_obligated',     COALESCE(SUM(total_estimated_cost) FILTER (
                             WHERE status IN ('budget_certified','approved','in_procurement','completed')
                           ), 0)::TEXT,
    'total_prs_value',     COALESCE(SUM(total_estimated_cost) FILTER (
                             WHERE status NOT IN ('cancelled')
                           ), 0)::TEXT
  )
  INTO v_result
  FROM procurements.purchase_requests
  WHERE division_id    = v_division_id
    AND fiscal_year_id = p_fiscal_year_id
    AND deleted_at     IS NULL;

  RETURN COALESCE(v_result, '{}'::JSONB);
END;
$$;
