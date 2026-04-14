-- Fuel Stock-In Enhancements: price tracking, PO reference, FIFO support
-- Adds columns to fuel_stock_movements for cost tracking and FIFO depletion.

-- ============================================================
-- 1. Add price_per_liter and po_number to fuel_stock_movements
-- ============================================================
ALTER TABLE procurements.fuel_stock_movements
  ADD COLUMN IF NOT EXISTS price_per_liter NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS po_number       TEXT,
  ADD COLUMN IF NOT EXISTS remaining_liters NUMERIC(12,4);

-- remaining_liters: for stock_in rows, tracks how many liters from this
-- batch have NOT yet been consumed. Starts equal to quantity_liters and
-- decreases as fuel requests deplete the batch (FIFO order).
-- NULL for stock_out and adjustment rows.

COMMENT ON COLUMN procurements.fuel_stock_movements.remaining_liters IS
  'FIFO tracking: remaining liters in this stock-in batch. NULL for non-stock-in rows.';

-- ============================================================
-- 2. Update fuel_manual_stock_in RPC to accept new params
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.fuel_manual_stock_in(
  p_fuel_type_id   UUID,
  p_office_id      UUID,
  p_quantity       NUMERIC,
  p_remarks        TEXT DEFAULT NULL,
  p_price_per_liter NUMERIC DEFAULT NULL,
  p_po_number      TEXT DEFAULT NULL
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

  -- Insert stock movement with FIFO tracking (remaining_liters = full quantity)
  INSERT INTO procurements.fuel_stock_movements (
    division_id, fuel_inventory_id, movement_type,
    quantity_liters, remaining_liters,
    price_per_liter, po_number,
    reference_type, reference_id,
    remarks, office_id, created_by
  ) VALUES (
    v_division_id, v_inventory_id, 'stock_in',
    p_quantity, p_quantity,
    p_price_per_liter, p_po_number,
    'manual', NULL,
    p_remarks, p_office_id, v_user_id
  );

  RETURN v_inventory_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.fuel_manual_stock_in(UUID, UUID, NUMERIC, TEXT, NUMERIC, TEXT) TO authenticated;

-- ============================================================
-- 3. Update approve_fuel_request to use FIFO depletion
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
  v_remaining_needed NUMERIC;
  v_batch            RECORD;
  v_deduct           NUMERIC;
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

  -- Determine approved liters
  v_actual_liters := COALESCE(p_liters_approved, v_request.liters_requested);

  IF v_actual_liters <= 0 THEN
    RAISE EXCEPTION 'Approved liters must be greater than zero';
  END IF;

  -- Find fuel inventory
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

  -- FIFO depletion: consume from oldest stock-in batches first
  v_remaining_needed := v_actual_liters;

  FOR v_batch IN
    SELECT id, remaining_liters
      FROM procurements.fuel_stock_movements
     WHERE fuel_inventory_id = v_inventory.id
       AND movement_type     = 'stock_in'
       AND remaining_liters  > 0
     ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_remaining_needed <= 0;

    IF v_batch.remaining_liters >= v_remaining_needed THEN
      v_deduct := v_remaining_needed;
    ELSE
      v_deduct := v_batch.remaining_liters;
    END IF;

    UPDATE procurements.fuel_stock_movements
       SET remaining_liters = remaining_liters - v_deduct
     WHERE id = v_batch.id;

    v_remaining_needed := v_remaining_needed - v_deduct;
  END LOOP;

  -- Insert stock-out movement
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
