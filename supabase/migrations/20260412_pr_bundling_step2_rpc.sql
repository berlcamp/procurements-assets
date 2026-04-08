-- Phase 7.1 — PR Bundling, Step 2 (RPC rewrite)
--
-- Rewrites create_purchase_request() to accept multiple APP items inside a
-- single Purchase Request. Each row in p_items now carries its own
-- app_item_id. All items must share the same procurement_mode (enforced by
-- the existing pr_items trigger from step 1) and the bundled total must
-- respect the ABC ceiling for that mode.
--
-- Also adds:
--   * add_pr_item(...)    — append a line to a draft PR
--   * remove_pr_item(...) — soft-delete a line from a draft PR
--
-- The deprecated `purchase_requests.app_item_id` column is still populated
-- (set from the first item) so that existing queries and the legacy partial
-- unique index keep working until step 3 drops them.

-- ============================================================
-- 1. create_purchase_request — new signature
-- ============================================================
DROP FUNCTION IF EXISTS procurements.create_purchase_request(UUID, UUID, TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION procurements.create_purchase_request(
  p_office_id      UUID,
  p_fiscal_year_id UUID,
  p_purpose        TEXT,
  p_items          JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_division_id     UUID;
  v_user_office     UUID;
  v_pr_number       TEXT;
  v_pr_id           UUID;
  v_total_cost      NUMERIC := 0;
  v_item            JSONB;
  v_idx             INT := 0;
  v_app_item        RECORD;
  v_first_app_item  RECORD;
  v_first_alloc     RECORD;
  v_fund_src_id     UUID := NULL;
  v_mode            TEXT;
  v_unified_mode    TEXT;
  v_ceiling         NUMERIC(15,2);
  v_app_item_id     UUID;
  v_row_total       NUMERIC;
  v_seen_app_items  UUID[] := ARRAY[]::UUID[];
BEGIN
  v_division_id := procurements.get_user_division_id();
  SELECT office_id INTO v_user_office FROM procurements.user_profiles WHERE id = auth.uid();

  IF v_division_id IS NULL THEN
    RAISE EXCEPTION 'User has no division assigned';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  -- ------------------------------------------------------------
  -- First pass: validate every referenced APP item, derive the
  -- unified procurement mode, accumulate total, capture the first
  -- APP item for legacy column / budget allocation.
  -- ------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := v_idx + 1;
    v_app_item_id := NULLIF(v_item->>'app_item_id', '')::UUID;

    IF v_app_item_id IS NULL THEN
      RAISE EXCEPTION 'Line % is missing app_item_id', v_idx;
    END IF;

    -- No duplicate APP items inside the same PR
    IF v_app_item_id = ANY(v_seen_app_items) THEN
      RAISE EXCEPTION 'Duplicate APP item in PR (line %)', v_idx;
    END IF;
    v_seen_app_items := array_append(v_seen_app_items, v_app_item_id);

    SELECT
      ai.*,
      a.status            AS app_status,
      a.indicative_final  AS app_indicative_final
    INTO v_app_item
    FROM procurements.app_items ai
    JOIN procurements.apps a ON a.id = ai.app_id
    WHERE ai.id          = v_app_item_id
      AND ai.deleted_at  IS NULL
      AND a.deleted_at   IS NULL
      AND a.division_id  = v_division_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'APP item % (line %) not found or not accessible', v_app_item_id, v_idx;
    END IF;

    IF v_app_item.app_status NOT IN ('approved', 'posted') THEN
      RAISE EXCEPTION 'Line % references an APP item from an APP that is not approved (status: %)',
        v_idx, v_app_item.app_status;
    END IF;

    IF NOT procurements.has_permission('ppmp.view_all') THEN
      IF v_app_item.source_office_id IS NOT NULL
         AND v_app_item.source_office_id <> v_user_office THEN
        RAISE EXCEPTION 'Line % references an APP item from another office. You can only PR for items from your own office.', v_idx;
      END IF;
    END IF;

    -- Reject if already locked to another active PR
    IF EXISTS (
      SELECT 1
        FROM procurements.pr_items pi
        JOIN procurements.purchase_requests pr ON pr.id = pi.purchase_request_id
       WHERE pi.app_item_id = v_app_item_id
         AND pi.deleted_at  IS NULL
         AND pr.deleted_at  IS NULL
         AND pr.status      <> 'cancelled'
    ) THEN
      RAISE EXCEPTION 'APP item on line % is already in another active Purchase Request', v_idx;
    END IF;

    -- Normalize mode
    v_mode := LOWER(TRIM(COALESCE(v_app_item.procurement_mode, '')));
    v_mode := CASE
      WHEN v_mode IN ('small value procurement', 'svp') THEN 'svp'
      WHEN v_mode IN ('public bidding', 'competitive bidding', 'bidding') THEN 'competitive_bidding'
      ELSE v_mode
    END;

    IF v_mode = '' THEN
      RAISE EXCEPTION 'APP item on line % has no procurement_mode set', v_idx;
    END IF;

    IF v_unified_mode IS NULL THEN
      v_unified_mode := v_mode;
      v_first_app_item := v_app_item;
    ELSIF v_unified_mode <> v_mode THEN
      RAISE EXCEPTION 'All items in a Purchase Request must share the same procurement mode (line 1 is %, line % is %)',
        v_unified_mode, v_idx, v_mode;
    END IF;

    -- Per-line cost validation against the APP item's own estimated_budget
    v_row_total := (v_item->>'quantity')::NUMERIC * (v_item->>'estimated_unit_cost')::NUMERIC;
    IF v_row_total > v_app_item.estimated_budget::NUMERIC THEN
      RAISE EXCEPTION 'Line % total (₱%) exceeds the APP item budget (₱%)',
        v_idx, v_row_total, v_app_item.estimated_budget;
    END IF;

    v_total_cost := v_total_cost + v_row_total;
  END LOOP;

  -- ------------------------------------------------------------
  -- Ceiling check (lookup table)
  -- ------------------------------------------------------------
  SELECT ceiling_amount INTO v_ceiling
    FROM procurements.procurement_method_ceilings
   WHERE procurement_mode = v_unified_mode;

  IF v_ceiling IS NOT NULL AND v_total_cost > v_ceiling THEN
    RAISE EXCEPTION 'Bundled total (₱%) exceeds the ABC ceiling for % (₱%). Use a different procurement method.',
      v_total_cost, v_unified_mode, v_ceiling;
  END IF;

  -- ------------------------------------------------------------
  -- Budget allocation check (uses the FIRST item's allocation)
  -- v1 limit: bundled PR draws from a single budget allocation.
  -- ------------------------------------------------------------
  IF v_first_app_item.budget_allocation_id IS NOT NULL THEN
    SELECT ba.fund_source_id, ba.adjusted_amount, ba.obligated_amount
      INTO v_first_alloc
      FROM procurements.budget_allocations ba
     WHERE ba.id = v_first_app_item.budget_allocation_id
       AND ba.deleted_at IS NULL;

    IF FOUND THEN
      v_fund_src_id := v_first_alloc.fund_source_id;
      IF (v_first_alloc.adjusted_amount::NUMERIC - v_first_alloc.obligated_amount::NUMERIC) < v_total_cost THEN
        RAISE EXCEPTION 'Insufficient budget. Available: ₱%, Requested: ₱%',
          (v_first_alloc.adjusted_amount::NUMERIC - v_first_alloc.obligated_amount::NUMERIC),
          v_total_cost;
      END IF;
    END IF;
  END IF;

  v_pr_number := procurements.generate_pr_number(p_office_id, p_fiscal_year_id, v_division_id);

  -- ------------------------------------------------------------
  -- Insert the PR header. The deprecated single-item columns are
  -- populated from the first item to keep legacy queries working.
  -- ------------------------------------------------------------
  INSERT INTO procurements.purchase_requests (
    division_id, pr_number, office_id, fiscal_year_id, purpose,
    requested_by, requested_at,
    fund_source_id, budget_allocation_id,
    ppmp_item_id, app_item_id, lot_id,
    procurement_mode, abc_ceiling,
    total_estimated_cost, status, created_by
  ) VALUES (
    v_division_id, v_pr_number, p_office_id, p_fiscal_year_id, p_purpose,
    auth.uid(), NOW(),
    v_fund_src_id, v_first_app_item.budget_allocation_id,
    v_first_app_item.source_ppmp_lot_id, v_first_app_item.id, v_first_app_item.lot_id,
    v_unified_mode, v_ceiling,
    v_total_cost, 'draft', auth.uid()
  )
  RETURNING id INTO v_pr_id;

  -- ------------------------------------------------------------
  -- Insert the line items
  -- ------------------------------------------------------------
  v_idx := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := v_idx + 1;
    v_app_item_id := (v_item->>'app_item_id')::UUID;

    INSERT INTO procurements.pr_items (
      purchase_request_id, item_number, description, unit, quantity,
      estimated_unit_cost,
      ppmp_item_id, app_item_id, remarks, office_id
    ) VALUES (
      v_pr_id,
      COALESCE((v_item->>'item_number')::INT, v_idx),
      v_item->>'description',
      v_item->>'unit',
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'estimated_unit_cost')::NUMERIC,
      (SELECT source_ppmp_lot_id FROM procurements.app_items WHERE id = v_app_item_id),
      v_app_item_id,
      NULLIF(v_item->>'remarks', ''),
      p_office_id
    );
  END LOOP;

  RETURN v_pr_id;
END;
$$;

-- ============================================================
-- 2. add_pr_item — append a line to a DRAFT PR
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.add_pr_item(
  p_pr_id              UUID,
  p_app_item_id        UUID,
  p_description        TEXT,
  p_unit               TEXT,
  p_quantity           NUMERIC,
  p_estimated_unit_cost NUMERIC,
  p_remarks            TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_pr            RECORD;
  v_division_id   UUID;
  v_app_item      RECORD;
  v_row_total     NUMERIC;
  v_new_total     NUMERIC;
  v_next_item_no  INT;
  v_pi_id         UUID;
BEGIN
  v_division_id := procurements.get_user_division_id();

  SELECT * INTO v_pr FROM procurements.purchase_requests WHERE id = p_pr_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Request not found';
  END IF;
  IF v_pr.status <> 'draft' THEN
    RAISE EXCEPTION 'Items can only be added while the PR is in draft (current: %)', v_pr.status;
  END IF;
  IF v_pr.division_id <> v_division_id THEN
    RAISE EXCEPTION 'Cannot modify a PR outside your division';
  END IF;

  SELECT ai.* INTO v_app_item
    FROM procurements.app_items ai
    JOIN procurements.apps a ON a.id = ai.app_id
   WHERE ai.id = p_app_item_id
     AND ai.deleted_at IS NULL
     AND a.deleted_at  IS NULL
     AND a.division_id = v_division_id
     AND a.status      IN ('approved', 'posted');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP item not found, not accessible, or its APP is not approved';
  END IF;

  v_row_total := p_quantity * p_estimated_unit_cost;
  IF v_row_total > v_app_item.estimated_budget::NUMERIC THEN
    RAISE EXCEPTION 'Line total (₱%) exceeds APP item budget (₱%)', v_row_total, v_app_item.estimated_budget;
  END IF;

  -- Recompute new total and re-check ceiling
  SELECT COALESCE(SUM(estimated_total_cost::NUMERIC), 0) + v_row_total
    INTO v_new_total
    FROM procurements.pr_items
   WHERE purchase_request_id = p_pr_id AND deleted_at IS NULL;

  IF v_pr.abc_ceiling IS NOT NULL AND v_new_total > v_pr.abc_ceiling THEN
    RAISE EXCEPTION 'Adding this line would exceed the ABC ceiling for % (₱%). New total: ₱%',
      v_pr.procurement_mode, v_pr.abc_ceiling, v_new_total;
  END IF;

  SELECT COALESCE(MAX(item_number), 0) + 1 INTO v_next_item_no
    FROM procurements.pr_items
   WHERE purchase_request_id = p_pr_id;

  INSERT INTO procurements.pr_items (
    purchase_request_id, item_number, description, unit, quantity,
    estimated_unit_cost,
    ppmp_item_id, app_item_id, remarks, office_id
  ) VALUES (
    p_pr_id, v_next_item_no, p_description, p_unit, p_quantity,
    p_estimated_unit_cost,
    v_app_item.source_ppmp_lot_id, p_app_item_id, NULLIF(p_remarks, ''),
    v_pr.office_id
  )
  RETURNING id INTO v_pi_id;

  -- Recalculate PR header total
  UPDATE procurements.purchase_requests
     SET total_estimated_cost = v_new_total,
         updated_at           = NOW()
   WHERE id = p_pr_id;

  RETURN v_pi_id;
END;
$$;

-- ============================================================
-- 3. remove_pr_item — soft-delete a line from a DRAFT PR
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.remove_pr_item(
  p_pr_item_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_pi   RECORD;
  v_pr   RECORD;
  v_new_total NUMERIC;
BEGIN
  SELECT * INTO v_pi FROM procurements.pr_items WHERE id = p_pr_item_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PR item not found';
  END IF;

  SELECT * INTO v_pr FROM procurements.purchase_requests WHERE id = v_pi.purchase_request_id;
  IF v_pr.status <> 'draft' THEN
    RAISE EXCEPTION 'Items can only be removed while the PR is in draft (current: %)', v_pr.status;
  END IF;
  IF v_pr.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Cannot modify a PR outside your division';
  END IF;

  UPDATE procurements.pr_items
     SET deleted_at = NOW()
   WHERE id = p_pr_item_id;

  SELECT COALESCE(SUM(estimated_total_cost::NUMERIC), 0)
    INTO v_new_total
    FROM procurements.pr_items
   WHERE purchase_request_id = v_pi.purchase_request_id AND deleted_at IS NULL;

  UPDATE procurements.purchase_requests
     SET total_estimated_cost = v_new_total,
         updated_at           = NOW()
   WHERE id = v_pi.purchase_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.create_purchase_request(UUID, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.add_pr_item(UUID, UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.remove_pr_item(UUID) TO authenticated;
