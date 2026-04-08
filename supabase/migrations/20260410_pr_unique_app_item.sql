-- Phase 7 hardening: enforce one active Purchase Request per APP item.
-- An "active" PR is anything not cancelled and not soft-deleted.
-- A new PR can be created for an APP item only if no active PR currently exists for it.

-- ============================================================
-- 1. Partial unique index on purchase_requests.app_item_id
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_pr_active_per_app_item
  ON procurements.purchase_requests (app_item_id)
  WHERE status <> 'cancelled' AND deleted_at IS NULL;

-- ============================================================
-- 2. Friendly guard inside create_purchase_request()
--    Re-create the function to add the duplicate check up front.
--    Body otherwise mirrors 20260408_procurement_rpc.sql.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.create_purchase_request(
  p_office_id      UUID,
  p_fiscal_year_id UUID,
  p_purpose        TEXT,
  p_app_item_id    UUID,
  p_items          JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_division_id   UUID;
  v_user_office   UUID;
  v_app_item      RECORD;
  v_budget_alloc  RECORD;
  v_fund_src_id   UUID;
  v_pr_number     TEXT;
  v_pr_id         UUID;
  v_total_cost    NUMERIC;
  v_item          JSONB;
  v_idx           INT := 0;
BEGIN
  v_division_id := procurements.get_user_division_id();
  SELECT office_id INTO v_user_office FROM procurements.user_profiles WHERE id = auth.uid();

  IF v_division_id IS NULL THEN
    RAISE EXCEPTION 'User has no division assigned';
  END IF;

  -- Reject duplicate active PR for the same APP item
  IF EXISTS (
    SELECT 1 FROM procurements.purchase_requests
     WHERE app_item_id = p_app_item_id
       AND status     <> 'cancelled'
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A Purchase Request already exists for this APP item. Cancel the existing PR before creating a new one.';
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

  IF v_app_item.app_status NOT IN ('approved', 'posted') THEN
    RAISE EXCEPTION 'Purchase Requests can only be created from an approved APP (current APP status: %)',
      v_app_item.app_status;
  END IF;

  IF NOT procurements.has_permission('ppmp.view_all') THEN
    IF v_app_item.source_office_id IS NOT NULL
       AND v_app_item.source_office_id <> v_user_office THEN
      RAISE EXCEPTION 'You can only create Purchase Requests for APP items originating from your own office';
    END IF;
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  SELECT COALESCE(SUM(
    (item->>'quantity')::NUMERIC * (item->>'estimated_unit_cost')::NUMERIC
  ), 0)
  INTO v_total_cost
  FROM jsonb_array_elements(p_items) AS item;

  IF v_total_cost > v_app_item.estimated_budget::NUMERIC THEN
    RAISE EXCEPTION 'Total estimated cost (₱%) exceeds APP item estimated budget (₱%)',
      v_total_cost, v_app_item.estimated_budget;
  END IF;

  IF v_app_item.budget_allocation_id IS NOT NULL THEN
    SELECT ba.fund_source_id, ba.adjusted_amount, ba.obligated_amount
      INTO v_budget_alloc
      FROM procurements.budget_allocations ba
     WHERE ba.id = v_app_item.budget_allocation_id
       AND ba.deleted_at IS NULL;

    IF FOUND THEN
      v_fund_src_id := v_budget_alloc.fund_source_id;
      IF (v_budget_alloc.adjusted_amount::NUMERIC - v_budget_alloc.obligated_amount::NUMERIC) < v_total_cost THEN
        RAISE EXCEPTION 'Insufficient budget. Available: ₱%, Requested: ₱%',
          (v_budget_alloc.adjusted_amount::NUMERIC - v_budget_alloc.obligated_amount::NUMERIC),
          v_total_cost;
      END IF;
    END IF;
  END IF;

  v_pr_number := procurements.generate_pr_number(p_office_id, p_fiscal_year_id, v_division_id);

  INSERT INTO procurements.purchase_requests (
    division_id, pr_number, office_id, fiscal_year_id, purpose,
    requested_by, requested_at,
    fund_source_id, budget_allocation_id,
    ppmp_item_id, app_item_id, lot_id,
    total_estimated_cost, status, created_by
  ) VALUES (
    v_division_id, v_pr_number, p_office_id, p_fiscal_year_id, p_purpose,
    auth.uid(), NOW(),
    v_fund_src_id, v_app_item.budget_allocation_id,
    v_app_item.source_ppmp_lot_id, p_app_item_id, v_app_item.lot_id,
    v_total_cost, 'draft', auth.uid()
  )
  RETURNING id INTO v_pr_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := v_idx + 1;
    INSERT INTO procurements.pr_items (
      purchase_request_id, item_number, description, unit, quantity,
      estimated_unit_cost, estimated_total_cost,
      ppmp_item_id, app_item_id, remarks, office_id
    ) VALUES (
      v_pr_id,
      COALESCE((v_item->>'item_number')::INT, v_idx),
      v_item->>'description',
      v_item->>'unit',
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'estimated_unit_cost')::NUMERIC,
      (v_item->>'quantity')::NUMERIC * (v_item->>'estimated_unit_cost')::NUMERIC,
      v_app_item.source_ppmp_lot_id, p_app_item_id,
      NULLIF(v_item->>'remarks', ''),
      p_office_id
    );
  END LOOP;

  RETURN v_pr_id;
END;
$$;
