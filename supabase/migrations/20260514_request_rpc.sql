-- Phase 14: Request System — RPC Functions
-- generate_request_number, create_request, submit_request,
-- approve_request, reject_request, cancel_request,
-- fulfill_request_from_stock, route_request_to_procurement

-- ============================================================
-- generate_request_number(p_office_id, p_division_id)
-- Returns: REQ-{OFFICE_CODE}-{YEAR}-{NNNN}
-- Uses sequence_counters table (counter_type = 'request'),
-- keyed by calendar year (not fiscal year).
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.generate_request_number(
  p_office_id   UUID,
  p_division_id UUID
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

  v_year := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;

  UPDATE procurements.sequence_counters
     SET last_value = last_value + 1
   WHERE division_id  = p_division_id
     AND office_id    = p_office_id
     AND counter_type = 'request'
     AND fiscal_year  = v_year
  RETURNING last_value INTO v_next;

  IF NOT FOUND THEN
    INSERT INTO procurements.sequence_counters
      (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
    VALUES
      (p_division_id, p_office_id, 'request', v_year, 1, 'REQ')
    RETURNING last_value INTO v_next;
  END IF;

  RETURN 'REQ-' || COALESCE(v_office_code, 'DIV') || '-' || v_year || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.generate_request_number(UUID, UUID) TO authenticated;

-- ============================================================
-- create_request(p_request_type, p_office_id, p_purpose,
--                p_urgency, p_items JSONB)
-- Creates a request in draft status with line items.
-- p_items: [{item_catalog_id?, description, unit, quantity_requested, remarks?}]
-- Returns: request UUID
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.create_request(
  p_request_type TEXT,
  p_office_id    UUID,
  p_purpose      TEXT,
  p_urgency      TEXT DEFAULT 'normal',
  p_items        JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_req_number    TEXT;
  v_req_id        UUID;
  v_item          JSONB;
  v_idx           INTEGER := 0;
  v_catalog_id    UUID;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('request.create') THEN
    RAISE EXCEPTION 'Insufficient permissions to create a request';
  END IF;

  v_division_id := procurements.get_user_division_id();

  IF v_division_id IS NULL THEN
    RAISE EXCEPTION 'User has no division assigned';
  END IF;

  -- Validate office belongs to division
  IF NOT EXISTS (
    SELECT 1 FROM procurements.offices
     WHERE id          = p_office_id
       AND division_id = v_division_id
       AND deleted_at  IS NULL
  ) THEN
    RAISE EXCEPTION 'Office not found in this division';
  END IF;

  -- Validate at least one item
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;

  -- Generate request number
  v_req_number := procurements.generate_request_number(p_office_id, v_division_id);

  -- Insert request
  INSERT INTO procurements.requests (
    division_id, request_number, request_type, office_id,
    requested_by, purpose, urgency, status, created_by
  ) VALUES (
    v_division_id, v_req_number, p_request_type, p_office_id,
    v_user_id, p_purpose, p_urgency, 'draft', v_user_id
  )
  RETURNING id INTO v_req_id;

  -- Insert line items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := v_idx + 1;

    v_catalog_id := NULLIF(v_item->>'item_catalog_id', '')::UUID;

    -- For supply/equipment/procurement types, item_catalog_id is required
    IF p_request_type IN ('supply', 'equipment', 'procurement') AND v_catalog_id IS NULL THEN
      RAISE EXCEPTION 'Item % requires an item catalog entry for % requests', v_idx, p_request_type;
    END IF;

    -- Validate item_catalog_id exists if provided
    IF v_catalog_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM procurements.item_catalog
         WHERE id          = v_catalog_id
           AND division_id = v_division_id
           AND deleted_at  IS NULL
           AND is_active   = true
      ) THEN
        RAISE EXCEPTION 'Item catalog entry on line % not found or inactive', v_idx;
      END IF;
    END IF;

    INSERT INTO procurements.request_items (
      request_id, item_catalog_id, description, unit,
      quantity_requested, item_number, remarks, office_id
    ) VALUES (
      v_req_id,
      v_catalog_id,
      COALESCE(v_item->>'description', ''),
      COALESCE(v_item->>'unit', 'pc'),
      (v_item->>'quantity_requested')::NUMERIC,
      v_idx,
      v_item->>'remarks',
      p_office_id
    );
  END LOOP;

  RETURN v_req_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.create_request(TEXT, UUID, TEXT, TEXT, JSONB) TO authenticated;

-- ============================================================
-- submit_request(p_request_id)
-- Validates draft request, auto-determines supervisor based on
-- office type, sets status to 'submitted'.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.submit_request(
  p_request_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_request       RECORD;
  v_office        RECORD;
  v_supervisor_id UUID;
  v_target_role   TEXT;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('request.create') THEN
    RAISE EXCEPTION 'Insufficient permissions to submit a request';
  END IF;

  v_division_id := procurements.get_user_division_id();

  -- Validate request
  SELECT * INTO v_request
    FROM procurements.requests
   WHERE id          = p_request_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.requested_by <> v_user_id THEN
    RAISE EXCEPTION 'Only the requester can submit this request';
  END IF;

  IF v_request.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft requests can be submitted (current: %)', v_request.status;
  END IF;

  -- Validate at least one item exists
  IF NOT EXISTS (
    SELECT 1 FROM procurements.request_items WHERE request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'Request must have at least one item before submission';
  END IF;

  -- Determine supervisor based on office type
  SELECT * INTO v_office
    FROM procurements.offices
   WHERE id = v_request.office_id;

  v_target_role := CASE v_office.office_type
    WHEN 'school'          THEN 'school_head'
    WHEN 'section'         THEN 'section_chief'
    WHEN 'division_office' THEN 'division_chief'
    ELSE 'section_chief'
  END;

  -- Find a user with the target role in this office
  SELECT ur.user_id INTO v_supervisor_id
    FROM procurements.user_roles ur
    JOIN procurements.roles r ON r.id = ur.role_id
   WHERE ur.office_id   = v_request.office_id
     AND ur.division_id = v_division_id
     AND r.name         = v_target_role
     AND ur.is_active   = true
   LIMIT 1;

  -- If no supervisor found in the office, try division-level approvers
  IF v_supervisor_id IS NULL THEN
    SELECT ur.user_id INTO v_supervisor_id
      FROM procurements.user_roles ur
      JOIN procurements.roles r ON r.id = ur.role_id
      JOIN procurements.role_permissions rp ON rp.role_id = r.id
      JOIN procurements.permissions p ON p.id = rp.permission_id
     WHERE ur.division_id = v_division_id
       AND p.code         = 'request.approve'
       AND ur.is_active   = true
     LIMIT 1;
  END IF;

  -- Update request
  UPDATE procurements.requests
     SET status        = 'submitted',
         supervisor_id = v_supervisor_id,
         updated_at    = NOW()
   WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.submit_request(UUID) TO authenticated;

-- ============================================================
-- approve_request(p_request_id, p_remarks)
-- Supervisor approves a submitted request.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.approve_request(
  p_request_id UUID,
  p_remarks    TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_division_id UUID;
  v_request     RECORD;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('request.approve') THEN
    RAISE EXCEPTION 'Insufficient permissions to approve requests';
  END IF;

  v_division_id := procurements.get_user_division_id();

  SELECT * INTO v_request
    FROM procurements.requests
   WHERE id          = p_request_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only submitted requests can be approved (current: %)', v_request.status;
  END IF;

  UPDATE procurements.requests
     SET status                = 'supervisor_approved',
         supervisor_id         = v_user_id,
         supervisor_approved_at = NOW(),
         supervisor_remarks    = p_remarks,
         updated_at            = NOW()
   WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.approve_request(UUID, TEXT) TO authenticated;

-- ============================================================
-- reject_request(p_request_id, p_reason)
-- Reject a request at any pre-fulfillment stage.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.reject_request(
  p_request_id UUID,
  p_reason     TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_division_id UUID;
  v_request     RECORD;
BEGIN
  -- Permission check
  IF NOT (procurements.has_permission('request.approve')
       OR procurements.has_permission('request.process')) THEN
    RAISE EXCEPTION 'Insufficient permissions to reject requests';
  END IF;

  v_division_id := procurements.get_user_division_id();

  SELECT * INTO v_request
    FROM procurements.requests
   WHERE id          = p_request_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.status NOT IN ('submitted', 'supervisor_approved', 'processing') THEN
    RAISE EXCEPTION 'Cannot reject request in status: %', v_request.status;
  END IF;

  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  UPDATE procurements.requests
     SET status           = 'rejected',
         rejection_reason = p_reason,
         rejected_by      = v_user_id,
         rejected_at      = NOW(),
         updated_at       = NOW()
   WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.reject_request(UUID, TEXT) TO authenticated;

-- ============================================================
-- cancel_request(p_request_id)
-- Requester cancels their own draft or submitted request.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.cancel_request(
  p_request_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_division_id UUID;
  v_request     RECORD;
BEGIN
  v_division_id := procurements.get_user_division_id();

  SELECT * INTO v_request
    FROM procurements.requests
   WHERE id          = p_request_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.requested_by <> v_user_id THEN
    RAISE EXCEPTION 'Only the requester can cancel this request';
  END IF;

  IF v_request.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'Cannot cancel request in status: %', v_request.status;
  END IF;

  UPDATE procurements.requests
     SET status       = 'cancelled',
         cancelled_by = v_user_id,
         cancelled_at = NOW(),
         updated_at   = NOW()
   WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.cancel_request(UUID) TO authenticated;

-- ============================================================
-- fulfill_request_from_stock(p_request_id, p_fulfillment_items JSONB)
-- Supply officer issues items from inventory for a request.
-- p_fulfillment_items: [{request_item_id, inventory_id, quantity_to_issue}]
-- Calls stock_out_for_issuance for each item.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.fulfill_request_from_stock(
  p_request_id        UUID,
  p_fulfillment_items JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id        UUID := auth.uid();
  v_division_id    UUID;
  v_request        RECORD;
  v_fi             JSONB;
  v_req_item       RECORD;
  v_qty_to_issue   NUMERIC;
  v_inventory_id   UUID;
  v_new_issued     NUMERIC;
  v_all_fulfilled  BOOLEAN := true;
  v_any_fulfilled  BOOLEAN := false;
  v_had_stock      BOOLEAN := false;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('request.process') THEN
    RAISE EXCEPTION 'Insufficient permissions to fulfill requests';
  END IF;

  v_division_id := procurements.get_user_division_id();

  -- Validate request
  SELECT * INTO v_request
    FROM procurements.requests
   WHERE id          = p_request_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.status NOT IN ('supervisor_approved', 'processing', 'partially_fulfilled') THEN
    RAISE EXCEPTION 'Request cannot be fulfilled in status: %', v_request.status;
  END IF;

  -- Set processor if not yet set
  IF v_request.processed_by IS NULL THEN
    UPDATE procurements.requests
       SET processed_by = v_user_id,
           processed_at = NOW()
     WHERE id = p_request_id;
  END IF;

  -- Process each fulfillment item
  FOR v_fi IN SELECT * FROM jsonb_array_elements(p_fulfillment_items)
  LOOP
    v_inventory_id := (v_fi->>'inventory_id')::UUID;
    v_qty_to_issue := (v_fi->>'quantity_to_issue')::NUMERIC;

    -- Validate request item belongs to this request
    SELECT * INTO v_req_item
      FROM procurements.request_items
     WHERE id         = (v_fi->>'request_item_id')::UUID
       AND request_id = p_request_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Request item % not found in this request',
        v_fi->>'request_item_id';
    END IF;

    -- Validate quantity
    IF v_qty_to_issue <= 0 THEN
      RAISE EXCEPTION 'Quantity to issue must be greater than zero';
    END IF;

    v_new_issued := v_req_item.quantity_issued + v_qty_to_issue;
    IF v_new_issued > v_req_item.quantity_requested THEN
      RAISE EXCEPTION 'Cannot issue more than requested for item %: requested %, already issued %, trying to issue %',
        v_req_item.item_number, v_req_item.quantity_requested,
        v_req_item.quantity_issued, v_qty_to_issue;
    END IF;

    -- Call stock_out_for_issuance (validates stock availability internally)
    PERFORM procurements.stock_out_for_issuance(
      v_inventory_id,
      v_qty_to_issue,
      'request',
      p_request_id,
      'Issued for ' || (
        SELECT request_number FROM procurements.requests WHERE id = p_request_id
      )
    );

    -- Update request item
    UPDATE procurements.request_items
       SET quantity_issued = v_new_issued,
           inventory_id    = v_inventory_id,
           updated_at      = NOW()
     WHERE id = (v_fi->>'request_item_id')::UUID;

    v_any_fulfilled := true;
    v_had_stock     := true;
  END LOOP;

  -- Determine final status by checking all items
  SELECT NOT EXISTS (
    SELECT 1 FROM procurements.request_items
     WHERE request_id         = p_request_id
       AND quantity_issued < quantity_requested
  ) INTO v_all_fulfilled;

  SELECT EXISTS (
    SELECT 1 FROM procurements.request_items
     WHERE request_id     = p_request_id
       AND quantity_issued > 0
  ) INTO v_any_fulfilled;

  -- Update request status and fulfillment type
  IF v_all_fulfilled THEN
    UPDATE procurements.requests
       SET status           = 'fulfilled',
           fulfillment_type = CASE
             WHEN fulfillment_type = 'procurement' THEN 'mixed'
             ELSE 'stock'
           END,
           updated_at       = NOW()
     WHERE id = p_request_id;
  ELSIF v_any_fulfilled THEN
    UPDATE procurements.requests
       SET status           = 'partially_fulfilled',
           fulfillment_type = COALESCE(fulfillment_type, 'stock'),
           updated_at       = NOW()
     WHERE id = p_request_id;
  ELSE
    UPDATE procurements.requests
       SET status     = 'processing',
           updated_at = NOW()
     WHERE id = p_request_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.fulfill_request_from_stock(UUID, JSONB) TO authenticated;

-- ============================================================
-- complete_service_request(p_request_id, p_remarks)
-- Marks a service request as fulfilled without stock movement.
-- Supply officer confirms service has been completed.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.complete_service_request(
  p_request_id UUID,
  p_remarks    TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_division_id UUID;
  v_request     RECORD;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('request.process') THEN
    RAISE EXCEPTION 'Insufficient permissions to complete service requests';
  END IF;

  v_division_id := procurements.get_user_division_id();

  SELECT * INTO v_request
    FROM procurements.requests
   WHERE id          = p_request_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.request_type <> 'service' THEN
    RAISE EXCEPTION 'This function is only for service requests';
  END IF;

  IF v_request.status NOT IN ('supervisor_approved', 'processing') THEN
    RAISE EXCEPTION 'Cannot complete service request in status: %', v_request.status;
  END IF;

  -- Mark all items as issued (quantity_issued = quantity_requested)
  UPDATE procurements.request_items
     SET quantity_issued = quantity_requested,
         remarks         = COALESCE(p_remarks, remarks),
         updated_at      = NOW()
   WHERE request_id = p_request_id;

  -- Update request
  UPDATE procurements.requests
     SET status           = 'fulfilled',
         fulfillment_type = 'stock',
         processed_by     = v_user_id,
         processed_at     = NOW(),
         updated_at       = NOW()
   WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.complete_service_request(UUID, TEXT) TO authenticated;

-- ============================================================
-- route_request_to_procurement(p_request_id, p_fiscal_year_id)
-- Creates a PR from unfulfilled request items and links it.
-- Returns: the new purchase_request UUID.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.route_request_to_procurement(
  p_request_id     UUID,
  p_fiscal_year_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_request       RECORD;
  v_pr_number     TEXT;
  v_pr_id         UUID;
  v_item          RECORD;
  v_idx           INTEGER := 0;
  v_any_issued    BOOLEAN;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('request.process') THEN
    RAISE EXCEPTION 'Insufficient permissions to route requests to procurement';
  END IF;

  v_division_id := procurements.get_user_division_id();

  -- Validate request
  SELECT * INTO v_request
    FROM procurements.requests
   WHERE id          = p_request_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF v_request.status NOT IN ('supervisor_approved', 'processing', 'partially_fulfilled') THEN
    RAISE EXCEPTION 'Request cannot be routed to procurement in status: %', v_request.status;
  END IF;

  IF v_request.linked_pr_id IS NOT NULL THEN
    RAISE EXCEPTION 'Request already has a linked purchase request';
  END IF;

  -- Validate fiscal year exists
  IF NOT EXISTS (
    SELECT 1 FROM procurements.fiscal_years
     WHERE id = p_fiscal_year_id AND status IN ('open', 'planning')
  ) THEN
    RAISE EXCEPTION 'Active fiscal year not found';
  END IF;

  -- Generate PR number
  v_pr_number := procurements.generate_pr_number(
    v_request.office_id, p_fiscal_year_id, v_division_id
  );

  -- Create the PR
  INSERT INTO procurements.purchase_requests (
    division_id, pr_number, office_id, fiscal_year_id,
    purpose, requested_by, requested_at,
    status, created_by
  ) VALUES (
    v_division_id, v_pr_number, v_request.office_id, p_fiscal_year_id,
    'From request ' || v_request.request_number || ': ' || v_request.purpose,
    v_user_id, NOW(),
    'draft', v_user_id
  )
  RETURNING id INTO v_pr_id;

  -- Insert unfulfilled items as PR line items
  FOR v_item IN
    SELECT ri.*
      FROM procurements.request_items ri
     WHERE ri.request_id = p_request_id
       AND ri.quantity_issued < ri.quantity_requested
     ORDER BY ri.item_number
  LOOP
    v_idx := v_idx + 1;

    INSERT INTO procurements.pr_items (
      purchase_request_id, item_number, description, unit,
      quantity, estimated_unit_cost, estimated_total_cost,
      created_by
    ) VALUES (
      v_pr_id,
      v_idx,
      v_item.description,
      v_item.unit,
      v_item.quantity_requested - v_item.quantity_issued,
      0,  -- cost to be filled by end user/supply officer
      0,
      v_user_id
    );
  END LOOP;

  IF v_idx = 0 THEN
    RAISE EXCEPTION 'No unfulfilled items to route to procurement';
  END IF;

  -- Check if any items were previously stock-fulfilled
  SELECT EXISTS (
    SELECT 1 FROM procurements.request_items
     WHERE request_id     = p_request_id
       AND quantity_issued > 0
  ) INTO v_any_issued;

  -- Update request
  UPDATE procurements.requests
     SET linked_pr_id    = v_pr_id,
         fulfillment_type = CASE WHEN v_any_issued THEN 'mixed' ELSE 'procurement' END,
         status           = 'fulfilled',
         processed_by     = COALESCE(processed_by, v_user_id),
         processed_at     = COALESCE(processed_at, NOW()),
         updated_at       = NOW()
   WHERE id = p_request_id;

  RETURN v_pr_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.route_request_to_procurement(UUID, UUID) TO authenticated;
