-- Fuel Request & Inventory Module — RPC Functions
-- generate_fuel_request_number, approve_fuel_request,
-- reject_fuel_request, cancel_fuel_request, dispense_fuel_request,
-- fuel_manual_stock_in, fuel_stock_adjustment

-- ============================================================
-- generate_fuel_request_number(p_office_id, p_division_id)
-- Returns: FTT-{OFFICE_CODE}-{YEAR}-{NNNN}
-- Uses sequence_counters table (counter_type = 'fuel_request'),
-- keyed by calendar year.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.generate_fuel_request_number(
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
     AND counter_type = 'fuel_request'
     AND fiscal_year  = v_year
  RETURNING last_value INTO v_next;

  IF NOT FOUND THEN
    INSERT INTO procurements.sequence_counters
      (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
    VALUES
      (p_division_id, p_office_id, 'fuel_request', v_year, 1, 'FTT')
    RETURNING last_value INTO v_next;
  END IF;

  RETURN 'FTT-' || COALESCE(v_office_code, 'DIV') || '-' || v_year || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.generate_fuel_request_number(UUID, UUID) TO authenticated;

-- ============================================================
-- approve_fuel_request(p_request_id, p_liters_approved, p_remarks)
-- Validates pending status, sets approved, deducts fuel from
-- inventory, inserts fuel_stock_movements and approval_logs.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.approve_fuel_request(
  p_request_id     UUID,
  p_liters_approved NUMERIC DEFAULT NULL,
  p_remarks        TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id          UUID := auth.uid();
  v_division_id      UUID;
  v_request          RECORD;
  v_actual_liters    NUMERIC;
  v_inventory        RECORD;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('fuel.approve') THEN
    RAISE EXCEPTION 'Insufficient permissions to approve fuel requests';
  END IF;

  v_division_id := procurements.get_user_division_id();

  -- Validate request
  SELECT * INTO v_request
    FROM procurements.fuel_requests
   WHERE id          = p_request_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fuel request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending fuel requests can be approved (current: %)', v_request.status;
  END IF;

  -- Determine approved liters (default to requested if not specified)
  v_actual_liters := COALESCE(p_liters_approved, v_request.liters_requested);

  IF v_actual_liters <= 0 THEN
    RAISE EXCEPTION 'Approved liters must be greater than zero';
  END IF;

  -- Find fuel inventory for this fuel type and office
  SELECT * INTO v_inventory
    FROM procurements.fuel_inventory
   WHERE fuel_type_id = v_request.fuel_type_id
     AND office_id    = v_request.office_id
     AND division_id  = v_division_id
     AND deleted_at   IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No fuel inventory found for this fuel type in the requesting office. Please stock-in fuel first.';
  END IF;

  IF v_inventory.current_liters < v_actual_liters THEN
    RAISE EXCEPTION 'Insufficient fuel stock. Available: % liters, Requested: % liters',
      v_inventory.current_liters, v_actual_liters;
  END IF;

  -- Deduct from inventory
  UPDATE procurements.fuel_inventory
     SET current_liters = current_liters - v_actual_liters,
         updated_at     = NOW()
   WHERE id = v_inventory.id;

  -- Insert stock movement (stock_out)
  INSERT INTO procurements.fuel_stock_movements (
    division_id, fuel_inventory_id, movement_type,
    quantity_liters, reference_type, reference_id,
    remarks, office_id, created_by
  ) VALUES (
    v_division_id, v_inventory.id, 'stock_out',
    v_actual_liters, 'fuel_request', p_request_id,
    'Fuel issued for ' || v_request.request_number,
    v_request.office_id, v_user_id
  );

  -- Update request
  UPDATE procurements.fuel_requests
     SET status           = 'approved',
         liters_approved  = v_actual_liters,
         approver_remarks = p_remarks,
         approved_by      = v_user_id,
         approved_at      = NOW(),
         updated_at       = NOW()
   WHERE id = p_request_id;

  -- Insert approval log
  INSERT INTO procurements.approval_logs (
    reference_type, reference_id,
    step_name, step_order, action,
    acted_by, acted_at, remarks, office_id
  ) VALUES (
    'fuel_request', p_request_id,
    'Fuel Manager Approval', 1, 'approved',
    v_user_id, NOW(), p_remarks, v_request.office_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.approve_fuel_request(UUID, NUMERIC, TEXT) TO authenticated;

-- ============================================================
-- reject_fuel_request(p_request_id, p_reason)
-- Validates pending status, sets rejected with reason.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.reject_fuel_request(
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
  IF NOT procurements.has_permission('fuel.approve') THEN
    RAISE EXCEPTION 'Insufficient permissions to reject fuel requests';
  END IF;

  v_division_id := procurements.get_user_division_id();

  SELECT * INTO v_request
    FROM procurements.fuel_requests
   WHERE id          = p_request_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fuel request not found';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending fuel requests can be rejected (current: %)', v_request.status;
  END IF;

  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  UPDATE procurements.fuel_requests
     SET status           = 'rejected',
         rejection_reason = p_reason,
         rejected_by      = v_user_id,
         rejected_at      = NOW(),
         updated_at       = NOW()
   WHERE id = p_request_id;

  -- Insert approval log
  INSERT INTO procurements.approval_logs (
    reference_type, reference_id,
    step_name, step_order, action,
    acted_by, acted_at, remarks, office_id
  ) VALUES (
    'fuel_request', p_request_id,
    'Fuel Manager Approval', 1, 'rejected',
    v_user_id, NOW(), p_reason, v_request.office_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.reject_fuel_request(UUID, TEXT) TO authenticated;

-- ============================================================
-- cancel_fuel_request(p_request_id)
-- Requester cancels their own pending request.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.cancel_fuel_request(
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
    FROM procurements.fuel_requests
   WHERE id          = p_request_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fuel request not found';
  END IF;

  IF v_request.requested_by <> v_user_id THEN
    RAISE EXCEPTION 'Only the requester can cancel this fuel request';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending fuel requests can be cancelled (current: %)', v_request.status;
  END IF;

  UPDATE procurements.fuel_requests
     SET status       = 'cancelled',
         cancelled_by = v_user_id,
         cancelled_at = NOW(),
         updated_at   = NOW()
   WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.cancel_fuel_request(UUID) TO authenticated;

-- ============================================================
-- dispense_fuel_request(p_request_id)
-- Marks an approved request as dispensed (fuel actually given).
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.dispense_fuel_request(
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
  -- Permission check
  IF NOT procurements.has_permission('fuel.manage_inventory') THEN
    RAISE EXCEPTION 'Insufficient permissions to dispense fuel';
  END IF;

  v_division_id := procurements.get_user_division_id();

  SELECT * INTO v_request
    FROM procurements.fuel_requests
   WHERE id          = p_request_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fuel request not found';
  END IF;

  IF v_request.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved fuel requests can be marked as dispensed (current: %)', v_request.status;
  END IF;

  UPDATE procurements.fuel_requests
     SET status       = 'dispensed',
         dispensed_at  = NOW(),
         updated_at    = NOW()
   WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.dispense_fuel_request(UUID) TO authenticated;

-- ============================================================
-- fuel_manual_stock_in(p_fuel_type_id, p_office_id, p_quantity, p_remarks)
-- Creates or updates fuel_inventory record and logs the movement.
-- Returns: fuel_inventory UUID
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.fuel_manual_stock_in(
  p_fuel_type_id UUID,
  p_office_id    UUID,
  p_quantity     NUMERIC,
  p_remarks      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_inventory_id  UUID;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('fuel.manage_inventory') THEN
    RAISE EXCEPTION 'Insufficient permissions to manage fuel inventory';
  END IF;

  v_division_id := procurements.get_user_division_id();

  IF v_division_id IS NULL THEN
    RAISE EXCEPTION 'User has no division assigned';
  END IF;

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  -- Validate fuel type
  IF NOT EXISTS (
    SELECT 1 FROM procurements.fuel_types
     WHERE id          = p_fuel_type_id
       AND division_id = v_division_id
       AND deleted_at  IS NULL
       AND is_active   = true
  ) THEN
    RAISE EXCEPTION 'Fuel type not found or inactive';
  END IF;

  -- Validate office
  IF NOT EXISTS (
    SELECT 1 FROM procurements.offices
     WHERE id          = p_office_id
       AND division_id = v_division_id
       AND deleted_at  IS NULL
  ) THEN
    RAISE EXCEPTION 'Office not found in this division';
  END IF;

  -- Upsert fuel inventory
  INSERT INTO procurements.fuel_inventory (
    division_id, fuel_type_id, office_id,
    current_liters, created_by
  ) VALUES (
    v_division_id, p_fuel_type_id, p_office_id,
    p_quantity, v_user_id
  )
  ON CONFLICT (fuel_type_id, office_id)
  DO UPDATE SET
    current_liters = procurements.fuel_inventory.current_liters + p_quantity,
    updated_at     = NOW()
  RETURNING id INTO v_inventory_id;

  -- Insert stock movement
  INSERT INTO procurements.fuel_stock_movements (
    division_id, fuel_inventory_id, movement_type,
    quantity_liters, reference_type, reference_id,
    remarks, office_id, created_by
  ) VALUES (
    v_division_id, v_inventory_id, 'stock_in',
    p_quantity, 'manual', NULL,
    p_remarks, p_office_id, v_user_id
  );

  RETURN v_inventory_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.fuel_manual_stock_in(UUID, UUID, NUMERIC, TEXT) TO authenticated;

-- ============================================================
-- fuel_stock_adjustment(p_fuel_inventory_id, p_new_quantity, p_remarks)
-- Adjusts fuel inventory to a new quantity, logging the delta.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.fuel_stock_adjustment(
  p_fuel_inventory_id UUID,
  p_new_quantity      NUMERIC,
  p_remarks           TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_inventory     RECORD;
  v_delta         NUMERIC;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('fuel.manage_inventory') THEN
    RAISE EXCEPTION 'Insufficient permissions to adjust fuel inventory';
  END IF;

  v_division_id := procurements.get_user_division_id();

  SELECT * INTO v_inventory
    FROM procurements.fuel_inventory
   WHERE id          = p_fuel_inventory_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fuel inventory record not found';
  END IF;

  IF p_new_quantity < 0 THEN
    RAISE EXCEPTION 'Adjusted quantity cannot be negative';
  END IF;

  v_delta := p_new_quantity - v_inventory.current_liters;

  IF v_delta = 0 THEN
    RETURN; -- No change needed
  END IF;

  -- Update inventory
  UPDATE procurements.fuel_inventory
     SET current_liters = p_new_quantity,
         updated_at     = NOW()
   WHERE id = p_fuel_inventory_id;

  -- Insert adjustment movement
  INSERT INTO procurements.fuel_stock_movements (
    division_id, fuel_inventory_id, movement_type,
    quantity_liters, reference_type, reference_id,
    remarks, office_id, created_by
  ) VALUES (
    v_division_id, p_fuel_inventory_id, 'adjustment',
    v_delta, 'adjustment', NULL,
    COALESCE(p_remarks, 'Stock adjustment from ' || v_inventory.current_liters || ' to ' || p_new_quantity),
    v_inventory.office_id, v_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.fuel_stock_adjustment(UUID, NUMERIC, TEXT) TO authenticated;
