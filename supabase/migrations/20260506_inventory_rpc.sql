-- Phase 12: Asset Management (Inventory) — RPC Functions
-- stock_in_from_delivery, manual_stock_in, stock_out_for_issuance, record_physical_count

-- ============================================================
-- stock_in_from_delivery(p_delivery_id)
-- Creates inventory entries from accepted delivery items.
-- Idempotent: rejects if delivery already stocked in.
-- Auto-creates item_catalog entries for unknown items.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.stock_in_from_delivery(
  p_delivery_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_delivery      RECORD;
  v_po            RECORD;
  v_di            RECORD;
  v_po_item       RECORD;
  v_catalog_id    UUID;
  v_inventory_id  UUID;
  v_accessible    UUID[];
  v_auto_seq      INTEGER;
BEGIN
  -- Permission check
  IF NOT (procurements.has_permission('inventory.manage') OR procurements.has_permission('asset.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to stock in from delivery';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  -- Validate delivery
  SELECT * INTO v_delivery
    FROM procurements.deliveries
   WHERE id          = p_delivery_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery % not found', p_delivery_id;
  END IF;

  IF v_delivery.inspection_status NOT IN ('passed', 'partial_acceptance') THEN
    RAISE EXCEPTION 'Delivery inspection must be passed or partial_acceptance (current: %)',
      v_delivery.inspection_status;
  END IF;

  -- Office scope check
  IF NOT (v_delivery.office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to manage inventory for this office';
  END IF;

  -- Idempotency check: prevent double stock-in
  IF EXISTS (
    SELECT 1 FROM procurements.stock_movements
    WHERE reference_type = 'delivery'
      AND reference_id   = p_delivery_id
      AND division_id    = v_division_id
  ) THEN
    RAISE EXCEPTION 'Delivery % has already been stocked in', p_delivery_id;
  END IF;

  -- Get PO for context
  SELECT * INTO v_po
    FROM procurements.purchase_orders
   WHERE id = v_delivery.purchase_order_id;

  -- Loop through accepted delivery items
  FOR v_di IN
    SELECT di.*
      FROM procurements.delivery_items di
     WHERE di.delivery_id = p_delivery_id
       AND di.quantity_accepted > 0
  LOOP
    -- Get PO item details
    SELECT * INTO v_po_item
      FROM procurements.po_items
     WHERE id = v_di.po_item_id;

    -- Find or create item_catalog entry
    SELECT id INTO v_catalog_id
      FROM procurements.item_catalog
     WHERE division_id = v_division_id
       AND name        = v_po_item.description
       AND unit        = v_po_item.unit
       AND deleted_at  IS NULL
     LIMIT 1;

    IF v_catalog_id IS NULL THEN
      -- Auto-generate a sequential code for the new catalog item
      SELECT COALESCE(MAX(
        CASE WHEN code ~ '^AUTO-\d+$'
             THEN SUBSTRING(code FROM 6)::INTEGER
             ELSE 0
        END
      ), 0) + 1
        INTO v_auto_seq
        FROM procurements.item_catalog
       WHERE division_id = v_division_id;

      INSERT INTO procurements.item_catalog (
        division_id, code, name, description,
        category, unit, is_active, created_by
      ) VALUES (
        v_division_id,
        'AUTO-' || LPAD(v_auto_seq::TEXT, 5, '0'),
        v_po_item.description,
        'Auto-created from delivery ' || v_delivery.delivery_number,
        'consumable',  -- default category; admin can reclassify
        v_po_item.unit,
        true,
        v_user_id
      )
      RETURNING id INTO v_catalog_id;
    END IF;

    -- Find or create inventory record
    SELECT id INTO v_inventory_id
      FROM procurements.inventory
     WHERE item_catalog_id = v_catalog_id
       AND office_id       = COALESCE(v_delivery.office_id, v_po.office_id)
       AND deleted_at      IS NULL;

    IF v_inventory_id IS NULL THEN
      INSERT INTO procurements.inventory (
        division_id, item_catalog_id, office_id,
        current_quantity, reorder_point, created_by
      ) VALUES (
        v_division_id,
        v_catalog_id,
        COALESCE(v_delivery.office_id, v_po.office_id),
        0,  -- trigger will update from stock_movement
        0,
        v_user_id
      )
      RETURNING id INTO v_inventory_id;
    END IF;

    -- Insert stock movement (trigger updates inventory.current_quantity)
    INSERT INTO procurements.stock_movements (
      division_id, inventory_id, movement_type,
      quantity, reference_type, reference_id,
      remarks, office_id, created_by
    ) VALUES (
      v_division_id,
      v_inventory_id,
      'stock_in',
      v_di.quantity_accepted,
      'delivery',
      p_delivery_id,
      'Stock in from delivery ' || v_delivery.delivery_number
        || ' (PO: ' || v_po.po_number || ')',
      COALESCE(v_delivery.office_id, v_po.office_id),
      v_user_id
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.stock_in_from_delivery(UUID) TO authenticated;

-- ============================================================
-- manual_stock_in(p_item_catalog_id, p_office_id, p_quantity, p_remarks)
-- For pre-existing items that existed before the system was deployed.
-- Returns: the inventory record UUID.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.manual_stock_in(
  p_item_catalog_id UUID,
  p_office_id       UUID,
  p_quantity        NUMERIC,
  p_remarks         TEXT DEFAULT NULL
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
  v_accessible    UUID[];
BEGIN
  -- Permission check
  IF NOT (procurements.has_permission('inventory.manage') OR procurements.has_permission('asset.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions for manual stock in';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  -- Office scope check
  IF NOT (p_office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to manage inventory for this office';
  END IF;

  -- Validate quantity
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  -- Validate item catalog exists and belongs to division
  IF NOT EXISTS (
    SELECT 1 FROM procurements.item_catalog
    WHERE id          = p_item_catalog_id
      AND division_id = v_division_id
      AND deleted_at  IS NULL
      AND is_active   = true
  ) THEN
    RAISE EXCEPTION 'Item catalog entry not found or inactive';
  END IF;

  -- Validate office exists in division
  IF NOT EXISTS (
    SELECT 1 FROM procurements.offices
    WHERE id          = p_office_id
      AND division_id = v_division_id
      AND deleted_at  IS NULL
  ) THEN
    RAISE EXCEPTION 'Office not found in this division';
  END IF;

  -- Find or create inventory record
  SELECT id INTO v_inventory_id
    FROM procurements.inventory
   WHERE item_catalog_id = p_item_catalog_id
     AND office_id       = p_office_id
     AND deleted_at      IS NULL;

  IF v_inventory_id IS NULL THEN
    INSERT INTO procurements.inventory (
      division_id, item_catalog_id, office_id,
      current_quantity, reorder_point, created_by
    ) VALUES (
      v_division_id, p_item_catalog_id, p_office_id,
      0, 0, v_user_id
    )
    RETURNING id INTO v_inventory_id;
  END IF;

  -- Insert stock movement (trigger updates inventory.current_quantity)
  INSERT INTO procurements.stock_movements (
    division_id, inventory_id, movement_type,
    quantity, reference_type, reference_id,
    remarks, office_id, created_by
  ) VALUES (
    v_division_id,
    v_inventory_id,
    'stock_in',
    p_quantity,
    'manual',
    NULL,
    COALESCE(p_remarks, 'Manual stock in'),
    p_office_id,
    v_user_id
  );

  RETURN v_inventory_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.manual_stock_in(UUID, UUID, NUMERIC, TEXT) TO authenticated;

-- ============================================================
-- stock_out_for_issuance(p_inventory_id, p_quantity, p_reference_type,
--                        p_reference_id, p_remarks)
-- Decrements stock for issuance (RIS, etc.).
-- Returns: the new stock_movement UUID.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.stock_out_for_issuance(
  p_inventory_id   UUID,
  p_quantity       NUMERIC,
  p_reference_type TEXT DEFAULT 'ris',
  p_reference_id   UUID DEFAULT NULL,
  p_remarks        TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_inv           RECORD;
  v_movement_id   UUID;
  v_accessible    UUID[];
BEGIN
  -- Permission check
  IF NOT (procurements.has_permission('inventory.manage') OR procurements.has_permission('asset.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions for stock out';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  -- Validate quantity
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  -- Validate inventory exists and belongs to division
  SELECT * INTO v_inv
    FROM procurements.inventory
   WHERE id          = p_inventory_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory record not found';
  END IF;

  -- Office scope check
  IF NOT (v_inv.office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to manage inventory for this office';
  END IF;

  -- Pre-check stock availability
  IF p_quantity > v_inv.current_quantity THEN
    RAISE EXCEPTION 'Insufficient stock: requested % but only % available',
      p_quantity, v_inv.current_quantity;
  END IF;

  -- Insert stock movement (trigger handles quantity decrement)
  INSERT INTO procurements.stock_movements (
    division_id, inventory_id, movement_type,
    quantity, reference_type, reference_id,
    remarks, office_id, created_by
  ) VALUES (
    v_division_id,
    p_inventory_id,
    'stock_out',
    p_quantity,
    p_reference_type,
    p_reference_id,
    p_remarks,
    v_inv.office_id,
    v_user_id
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.stock_out_for_issuance(UUID, NUMERIC, TEXT, UUID, TEXT) TO authenticated;

-- ============================================================
-- record_physical_count(p_inventory_id, p_counted_quantity, p_remarks)
-- Records physical count and creates adjustment if variance exists.
-- Returns: the variance (positive = surplus, negative = shortage).
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.record_physical_count(
  p_inventory_id     UUID,
  p_counted_quantity NUMERIC,
  p_remarks          TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_inv           RECORD;
  v_variance      NUMERIC;
  v_accessible    UUID[];
BEGIN
  -- Permission check
  IF NOT (procurements.has_permission('inventory.manage') OR procurements.has_permission('asset.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions for physical count';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  -- Validate counted quantity
  IF p_counted_quantity < 0 THEN
    RAISE EXCEPTION 'Counted quantity cannot be negative';
  END IF;

  -- Validate inventory exists and belongs to division
  SELECT * INTO v_inv
    FROM procurements.inventory
   WHERE id          = p_inventory_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory record not found';
  END IF;

  -- Office scope check
  IF NOT (v_inv.office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to manage inventory for this office';
  END IF;

  -- Calculate variance
  v_variance := p_counted_quantity - v_inv.current_quantity;

  -- If there's a variance, create an adjustment movement
  IF v_variance <> 0 THEN
    INSERT INTO procurements.stock_movements (
      division_id, inventory_id, movement_type,
      quantity, reference_type, reference_id,
      remarks, office_id, created_by
    ) VALUES (
      v_division_id,
      p_inventory_id,
      'adjustment',
      v_variance,  -- signed: positive = surplus, negative = shortage
      'physical_count',
      NULL,
      COALESCE(p_remarks, 'Physical count adjustment'),
      v_inv.office_id,
      v_user_id
    );
    -- Trigger handles updating inventory.current_quantity
  END IF;

  -- Update last count information
  UPDATE procurements.inventory
     SET last_count_date     = CURRENT_DATE,
         last_count_quantity = p_counted_quantity,
         updated_at          = NOW()
   WHERE id = p_inventory_id;

  RETURN v_variance;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.record_physical_count(UUID, NUMERIC, TEXT) TO authenticated;
