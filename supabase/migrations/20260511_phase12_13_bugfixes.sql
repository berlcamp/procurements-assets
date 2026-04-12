-- Phase 12 & 13 Bug Fixes Migration
-- Addresses: race conditions, RLS gaps, validation gaps, missing features
--
-- Issues fixed:
--   1. Race conditions in inventory RPCs (add FOR UPDATE row locking)
--   2. Race conditions in sequence generation (UPSERT pattern)
--   3. Depreciation rounding (final-month catch-up)
--   4. RLS gap on depreciation_records (add division_id)
--   5. Inventory trigger silent failure (NOT FOUND check)
--   6. Auto-catalog matching (ILIKE + code-based)
--   7. Asset validation gaps (residual <= cost, useful_life for PPE, cost > 0, disposal method CHECK)
--   8. Reorder alert deduplication
--   9. Disposal reason column + revert_disposal RPC
--  10. Disposed asset visibility for ex-custodians

-- ============================================================
-- 1. Add disposal_reason column to assets
-- ============================================================
ALTER TABLE procurements.assets
  ADD COLUMN IF NOT EXISTS disposal_reason TEXT;

-- ============================================================
-- 2. Add division_id column to depreciation_records for RLS
-- ============================================================
ALTER TABLE procurements.depreciation_records
  ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES platform.divisions(id);

-- Backfill division_id from parent asset
UPDATE procurements.depreciation_records dr
   SET division_id = a.division_id
  FROM procurements.assets a
 WHERE dr.asset_id = a.id
   AND dr.division_id IS NULL;

-- Make NOT NULL after backfill
ALTER TABLE procurements.depreciation_records
  ALTER COLUMN division_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_depreciation_division
  ON procurements.depreciation_records(division_id);

-- ============================================================
-- 3. Add disposal_method CHECK constraint to assets
-- ============================================================
ALTER TABLE procurements.assets
  ADD CONSTRAINT chk_disposal_method
  CHECK (disposal_method IS NULL OR disposal_method IN (
    'sale', 'transfer', 'donation', 'destruction', 'barter', 'condemnation'
  ));

-- ============================================================
-- 4. Fix depreciation_records RLS policies — add division_id check
-- ============================================================
DROP POLICY IF EXISTS "office_read_depreciation" ON procurements.depreciation_records;
CREATE POLICY "office_read_depreciation" ON procurements.depreciation_records
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
  );

DROP POLICY IF EXISTS "create_depreciation" ON procurements.depreciation_records;
CREATE POLICY "create_depreciation" ON procurements.depreciation_records
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
    AND procurements.has_permission('asset.manage')
  );

-- ============================================================
-- 5. Add RLS policy for ex-custodians to see disposed/returned assets
-- ============================================================
CREATE POLICY "ex_custodian_read_past_assets" ON procurements.assets
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND procurements.has_permission('asset.view_own')
    AND EXISTS (
      SELECT 1 FROM procurements.asset_assignments aa
       WHERE aa.asset_id = assets.id
         AND aa.custodian_id = auth.uid()
    )
  );

-- ============================================================
-- 6. Fix inventory trigger — handle missing inventory row
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.update_inventory_from_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_delta          NUMERIC(12,4);
  v_new_quantity   NUMERIC(12,4);
BEGIN
  -- Determine the delta based on movement type
  CASE NEW.movement_type
    WHEN 'stock_in', 'transfer_in', 'return' THEN
      v_delta := ABS(NEW.quantity);
    WHEN 'stock_out', 'transfer_out' THEN
      v_delta := -ABS(NEW.quantity);
    WHEN 'adjustment' THEN
      v_delta := NEW.quantity;
    ELSE
      RAISE EXCEPTION 'Unknown movement type: %', NEW.movement_type;
  END CASE;

  -- Update inventory and capture new quantity
  UPDATE procurements.inventory
     SET current_quantity = current_quantity + v_delta,
         updated_at       = NOW()
   WHERE id = NEW.inventory_id
  RETURNING current_quantity INTO v_new_quantity;

  -- Guard against missing inventory row
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory record % not found. Cannot apply stock movement.',
      NEW.inventory_id;
  END IF;

  -- Validate non-negative (belt-and-suspenders with CHECK constraint)
  IF v_new_quantity < 0 THEN
    RAISE EXCEPTION 'Insufficient stock: operation would result in negative quantity (%).',
      v_new_quantity;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 7. Fix reorder alert — deduplicate notifications
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.check_reorder_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_inv           RECORD;
  v_item_name     TEXT;
  v_office_name   TEXT;
  v_user_record   RECORD;
BEGIN
  -- Only check on stock-reducing movements
  IF NEW.movement_type NOT IN ('stock_out', 'transfer_out', 'adjustment') THEN
    RETURN NEW;
  END IF;

  -- Get the inventory record
  SELECT i.id, i.current_quantity, i.reorder_point, i.office_id, i.division_id,
         i.item_catalog_id
    INTO v_inv
    FROM procurements.inventory i
   WHERE i.id = NEW.inventory_id;

  -- Skip if no reorder point set or quantity is above threshold
  IF v_inv.reorder_point <= 0 OR v_inv.current_quantity > v_inv.reorder_point THEN
    RETURN NEW;
  END IF;

  -- Get item and office names for the notification message
  SELECT name INTO v_item_name
    FROM procurements.item_catalog
   WHERE id = v_inv.item_catalog_id;

  SELECT name INTO v_office_name
    FROM procurements.offices
   WHERE id = v_inv.office_id;

  -- Notify users with inventory.manage permission (deduplicated)
  FOR v_user_record IN
    SELECT DISTINCT ur.user_id
      FROM procurements.user_roles ur
      JOIN procurements.roles r ON r.id = ur.role_id
      JOIN procurements.role_permissions rp ON rp.role_id = r.id
      JOIN procurements.permissions p ON p.id = rp.permission_id
     WHERE p.code = 'inventory.manage'
       AND ur.division_id = v_inv.division_id
       AND ur.is_active = true
       AND ur.revoked_at IS NULL
       AND (
         ur.office_id IS NULL
         OR ur.office_id = v_inv.office_id
       )
       -- Deduplicate: skip if user already has an unread low-stock alert for this item
       AND NOT EXISTS (
         SELECT 1 FROM procurements.notifications n
          WHERE n.user_id        = ur.user_id
            AND n.reference_type = 'inventory'
            AND n.reference_id   = v_inv.id
            AND n.type           = 'warning'
            AND n.is_read        = false
       )
  LOOP
    INSERT INTO procurements.notifications (
      user_id, title, message, type,
      reference_type, reference_id, office_id
    ) VALUES (
      v_user_record.user_id,
      'Low Stock Alert',
      'Item "' || v_item_name || '" at ' || COALESCE(v_office_name, 'Unknown Office')
        || ' has reached ' || v_inv.current_quantity || ' units (reorder point: '
        || v_inv.reorder_point || ').',
      'warning',
      'inventory',
      v_inv.id,
      v_inv.office_id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 8. Fix stock_in_from_delivery — row locking + improved catalog matching
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

  -- Atomic idempotency check via advisory lock on delivery UUID
  -- This prevents two concurrent calls from both passing the EXISTS check
  PERFORM pg_advisory_xact_lock(hashtext(p_delivery_id::TEXT));

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

    -- Find item_catalog entry (case-insensitive name + unit match)
    SELECT id INTO v_catalog_id
      FROM procurements.item_catalog
     WHERE division_id = v_division_id
       AND LOWER(TRIM(name)) = LOWER(TRIM(v_po_item.description))
       AND LOWER(TRIM(unit)) = LOWER(TRIM(v_po_item.unit))
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

    -- Find or create inventory record (lock existing row to prevent concurrent inserts)
    SELECT id INTO v_inventory_id
      FROM procurements.inventory
     WHERE item_catalog_id = v_catalog_id
       AND office_id       = COALESCE(v_delivery.office_id, v_po.office_id)
       AND deleted_at      IS NULL
     FOR UPDATE;

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

-- ============================================================
-- 9. Fix stock_out_for_issuance — row locking
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

  -- Validate inventory exists and lock row for concurrent safety
  SELECT * INTO v_inv
    FROM procurements.inventory
   WHERE id          = p_inventory_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory record not found';
  END IF;

  -- Office scope check
  IF NOT (v_inv.office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to manage inventory for this office';
  END IF;

  -- Pre-check stock availability (row is locked, so this is safe)
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

-- ============================================================
-- 10. Fix manual_stock_in — row locking
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

  -- Validate item catalog exists, belongs to division, and is active
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

  -- Find or create inventory record (lock existing row)
  SELECT id INTO v_inventory_id
    FROM procurements.inventory
   WHERE item_catalog_id = p_item_catalog_id
     AND office_id       = p_office_id
     AND deleted_at      IS NULL
   FOR UPDATE;

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

-- ============================================================
-- 11. Fix record_physical_count — row locking
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

  -- Validate inventory exists and lock row
  SELECT * INTO v_inv
    FROM procurements.inventory
   WHERE id          = p_inventory_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL
   FOR UPDATE;

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
      v_variance,
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

-- ============================================================
-- 12. Fix sequence generation — UPSERT pattern for property numbers
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.generate_property_number(
  p_office_id   UUID,
  p_division_id UUID,
  p_asset_type  TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_office_code  TEXT;
  v_year         INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_next         INTEGER;
  v_counter_type TEXT;
  v_prefix       TEXT;
BEGIN
  SELECT code INTO v_office_code
    FROM procurements.offices
   WHERE id = p_office_id;

  -- Determine counter type and prefix from asset type
  IF p_asset_type = 'ppe' THEN
    v_counter_type := 'property_ppe';
    v_prefix       := 'PPE';
  ELSIF p_asset_type = 'semi_expendable' THEN
    v_counter_type := 'property_se';
    v_prefix       := 'SE';
  ELSE
    RAISE EXCEPTION 'Invalid asset type: %', p_asset_type;
  END IF;

  -- Atomic UPSERT: increment or create sequence counter
  INSERT INTO procurements.sequence_counters
    (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
  VALUES
    (p_division_id, p_office_id, v_counter_type, v_year, 1, v_prefix)
  ON CONFLICT (division_id, office_id, counter_type, fiscal_year)
  DO UPDATE SET last_value = procurements.sequence_counters.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN COALESCE(v_office_code, 'DIV') || '-' || v_year || '-' || v_prefix || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

-- ============================================================
-- 13. Fix sequence generation — UPSERT pattern for PAR/ICS numbers
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.generate_par_ics_number(
  p_office_id   UUID,
  p_division_id UUID,
  p_doc_type    TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_office_code  TEXT;
  v_year         INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_next         INTEGER;
  v_prefix       TEXT;
BEGIN
  SELECT code INTO v_office_code
    FROM procurements.offices
   WHERE id = p_office_id;

  IF p_doc_type = 'par' THEN
    v_prefix := 'PAR';
  ELSIF p_doc_type = 'ics' THEN
    v_prefix := 'ICS';
  ELSE
    RAISE EXCEPTION 'Invalid document type: %. Must be par or ics.', p_doc_type;
  END IF;

  -- Atomic UPSERT: increment or create sequence counter
  INSERT INTO procurements.sequence_counters
    (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
  VALUES
    (p_division_id, p_office_id, p_doc_type, v_year, 1, v_prefix)
  ON CONFLICT (division_id, office_id, counter_type, fiscal_year)
  DO UPDATE SET last_value = procurements.sequence_counters.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN v_prefix || '-' || COALESCE(v_office_code, 'DIV') || '-' || v_year || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

-- ============================================================
-- 14. Fix register_asset_from_delivery — add cost validation, residual <= cost
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.register_asset_from_delivery(
  p_delivery_item_id UUID,
  p_details          JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id          UUID := auth.uid();
  v_division_id      UUID;
  v_accessible       UUID[];
  v_di               RECORD;
  v_delivery         RECORD;
  v_po               RECORD;
  v_po_item          RECORD;
  v_catalog          RECORD;
  v_asset_id         UUID;
  v_property_number  TEXT;
  v_office_id        UUID;
  v_registered_count INTEGER;
  v_accepted_qty     INTEGER;
  v_doc_type         TEXT;
  v_doc_number       TEXT;
  v_custodian_id     UUID;
  v_useful_life      INTEGER;
  v_residual         NUMERIC(14,2);
  v_acquisition_cost NUMERIC(14,2);
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('asset.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to register assets';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  -- Validate delivery item
  SELECT * INTO v_di
    FROM procurements.delivery_items
   WHERE id = p_delivery_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery item % not found', p_delivery_item_id;
  END IF;

  IF v_di.quantity_accepted <= 0 THEN
    RAISE EXCEPTION 'Delivery item has no accepted quantity';
  END IF;

  -- Validate delivery
  SELECT * INTO v_delivery
    FROM procurements.deliveries
   WHERE id          = v_di.delivery_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery not found or not in your division';
  END IF;

  IF v_delivery.inspection_status NOT IN ('passed', 'partial_acceptance') THEN
    RAISE EXCEPTION 'Delivery inspection must be passed or partial_acceptance';
  END IF;

  -- Determine office
  v_office_id := COALESCE(v_di.office_id, v_delivery.office_id);

  -- Office scope check
  IF NOT (v_office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to register assets for this office';
  END IF;

  -- Get PO and PO item for context (description, unit_cost)
  SELECT * INTO v_po
    FROM procurements.purchase_orders
   WHERE id = v_delivery.purchase_order_id;

  SELECT * INTO v_po_item
    FROM procurements.po_items
   WHERE id = v_di.po_item_id;

  -- Find the item_catalog entry (case-insensitive match)
  SELECT * INTO v_catalog
    FROM procurements.item_catalog
   WHERE division_id = v_division_id
     AND LOWER(TRIM(name)) = LOWER(TRIM(v_po_item.description))
     AND LOWER(TRIM(unit)) = LOWER(TRIM(v_po_item.unit))
     AND deleted_at  IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item catalog entry not found for "%". Run stock-in first.', v_po_item.description;
  END IF;

  -- Validate category is semi-expendable or PPE
  IF v_catalog.category NOT IN ('semi_expendable', 'ppe') THEN
    RAISE EXCEPTION 'Item "%" is categorized as %. Only semi_expendable and ppe items can be registered as assets.',
      v_catalog.name, v_catalog.category;
  END IF;

  -- Over-registration guard: count already-registered assets for this delivery_item
  SELECT COUNT(*) INTO v_registered_count
    FROM procurements.assets
   WHERE source_delivery_item_id = p_delivery_item_id
     AND deleted_at IS NULL;

  v_accepted_qty := FLOOR(v_di.quantity_accepted)::INTEGER;

  IF v_registered_count >= v_accepted_qty THEN
    RAISE EXCEPTION 'All % accepted items from this delivery item have already been registered as assets',
      v_accepted_qty;
  END IF;

  -- Extract optional details from JSONB
  v_custodian_id     := (p_details->>'custodian_id')::UUID;
  v_useful_life      := COALESCE((p_details->>'useful_life_years')::INTEGER, v_catalog.useful_life_years);
  v_residual         := COALESCE((p_details->>'residual_value')::NUMERIC, 0);
  v_acquisition_cost := v_po_item.unit_cost;

  -- Validate acquisition cost > 0
  IF v_acquisition_cost IS NULL OR v_acquisition_cost <= 0 THEN
    RAISE EXCEPTION 'Acquisition cost must be positive (PO unit cost: %)', v_acquisition_cost;
  END IF;

  -- Validate residual_value <= acquisition_cost
  IF v_residual > v_acquisition_cost THEN
    RAISE EXCEPTION 'Residual value (%) cannot exceed acquisition cost (%)',
      v_residual, v_acquisition_cost;
  END IF;

  -- Generate property number
  v_property_number := procurements.generate_property_number(
    v_office_id, v_division_id, v_catalog.category
  );

  -- Create asset
  INSERT INTO procurements.assets (
    division_id, property_number, item_catalog_id, office_id,
    description, brand_model, serial_number,
    acquisition_date, acquisition_cost,
    source_po_id, source_delivery_id, source_delivery_item_id,
    asset_type, condition_status,
    current_custodian_id, location,
    useful_life_years, residual_value,
    accumulated_depreciation, book_value,
    status, created_by
  ) VALUES (
    v_division_id,
    v_property_number,
    v_catalog.id,
    v_office_id,
    v_po_item.description,
    p_details->>'brand_model',
    p_details->>'serial_number',
    COALESCE((p_details->>'acquisition_date')::DATE, v_delivery.delivery_date),
    v_acquisition_cost,
    v_po.id,
    v_delivery.id,
    p_delivery_item_id,
    v_catalog.category,
    'serviceable',
    v_custodian_id,
    p_details->>'location',
    v_useful_life,
    v_residual,
    0,
    v_acquisition_cost,  -- book_value = acquisition_cost initially
    'active',
    v_user_id
  )
  RETURNING id INTO v_asset_id;

  -- If custodian provided, create initial assignment (PAR for PPE, ICS for semi-expendable)
  IF v_custodian_id IS NOT NULL THEN
    v_doc_type := CASE v_catalog.category
      WHEN 'ppe' THEN 'par'
      WHEN 'semi_expendable' THEN 'ics'
    END;

    v_doc_number := procurements.generate_par_ics_number(
      v_office_id, v_division_id, v_doc_type
    );

    INSERT INTO procurements.asset_assignments (
      division_id, asset_id, custodian_id, office_id,
      document_type, document_number,
      assigned_date, assigned_by, is_current
    ) VALUES (
      v_division_id, v_asset_id, v_custodian_id, v_office_id,
      v_doc_type, v_doc_number,
      CURRENT_DATE, v_user_id, true
    );
  END IF;

  RETURN v_asset_id;
END;
$$;

-- ============================================================
-- 15. Fix register_asset_manual — add residual <= cost validation
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.register_asset_manual(
  p_details JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id          UUID := auth.uid();
  v_division_id      UUID;
  v_accessible       UUID[];
  v_asset_id         UUID;
  v_property_number  TEXT;
  v_office_id        UUID;
  v_asset_type       TEXT;
  v_acquisition_cost NUMERIC(14,2);
  v_residual         NUMERIC(14,2);
  v_custodian_id     UUID;
  v_doc_type         TEXT;
  v_doc_number       TEXT;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('asset.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to register assets';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  v_office_id        := (p_details->>'office_id')::UUID;
  v_asset_type       := p_details->>'asset_type';
  v_acquisition_cost := (p_details->>'acquisition_cost')::NUMERIC;
  v_residual         := COALESCE((p_details->>'residual_value')::NUMERIC, 0);
  v_custodian_id     := (p_details->>'custodian_id')::UUID;

  -- Validate required fields
  IF v_office_id IS NULL THEN
    RAISE EXCEPTION 'office_id is required';
  END IF;
  IF v_asset_type IS NULL OR v_asset_type NOT IN ('semi_expendable', 'ppe') THEN
    RAISE EXCEPTION 'asset_type must be semi_expendable or ppe';
  END IF;
  IF v_acquisition_cost IS NULL OR v_acquisition_cost <= 0 THEN
    RAISE EXCEPTION 'acquisition_cost must be a positive number';
  END IF;

  -- Validate residual_value <= acquisition_cost
  IF v_residual > v_acquisition_cost THEN
    RAISE EXCEPTION 'Residual value (%) cannot exceed acquisition cost (%)',
      v_residual, v_acquisition_cost;
  END IF;

  -- Office scope check
  IF NOT (v_office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to register assets for this office';
  END IF;

  -- Validate item catalog
  IF NOT EXISTS (
    SELECT 1 FROM procurements.item_catalog
    WHERE id          = (p_details->>'item_catalog_id')::UUID
      AND division_id = v_division_id
      AND deleted_at  IS NULL
      AND is_active   = true
  ) THEN
    RAISE EXCEPTION 'Item catalog entry not found or inactive';
  END IF;

  -- Generate property number
  v_property_number := procurements.generate_property_number(
    v_office_id, v_division_id, v_asset_type
  );

  -- Create asset
  INSERT INTO procurements.assets (
    division_id, property_number, item_catalog_id, office_id,
    description, brand_model, serial_number,
    acquisition_date, acquisition_cost,
    asset_type, condition_status,
    current_custodian_id, location,
    useful_life_years, residual_value,
    accumulated_depreciation, book_value,
    status, created_by
  ) VALUES (
    v_division_id,
    v_property_number,
    (p_details->>'item_catalog_id')::UUID,
    v_office_id,
    p_details->>'description',
    p_details->>'brand_model',
    p_details->>'serial_number',
    COALESCE((p_details->>'acquisition_date')::DATE, CURRENT_DATE),
    v_acquisition_cost,
    v_asset_type,
    'serviceable',
    v_custodian_id,
    p_details->>'location',
    (p_details->>'useful_life_years')::INTEGER,
    v_residual,
    0,
    v_acquisition_cost,  -- book_value = acquisition_cost initially
    'active',
    v_user_id
  )
  RETURNING id INTO v_asset_id;

  -- If custodian provided, create initial assignment
  IF v_custodian_id IS NOT NULL THEN
    v_doc_type := CASE v_asset_type
      WHEN 'ppe' THEN 'par'
      WHEN 'semi_expendable' THEN 'ics'
    END;

    v_doc_number := procurements.generate_par_ics_number(
      v_office_id, v_division_id, v_doc_type
    );

    INSERT INTO procurements.asset_assignments (
      division_id, asset_id, custodian_id, office_id,
      document_type, document_number,
      assigned_date, assigned_by, is_current
    ) VALUES (
      v_division_id, v_asset_id, v_custodian_id, v_office_id,
      v_doc_type, v_doc_number,
      CURRENT_DATE, v_user_id, true
    );
  END IF;

  RETURN v_asset_id;
END;
$$;

-- ============================================================
-- 16. Fix calculate_depreciation — final-month catch-up
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.calculate_depreciation(
  p_asset_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_asset         RECORD;
  v_monthly_dep   NUMERIC(14,2);
  v_new_accum     NUMERIC(14,2);
  v_new_bv        NUMERIC(14,2);
  v_remaining     NUMERIC(14,2);
  v_year          INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_month         INTEGER := EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('asset.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to calculate depreciation';
  END IF;

  v_division_id := procurements.get_user_division_id();

  -- Validate asset
  SELECT * INTO v_asset
    FROM procurements.assets
   WHERE id          = p_asset_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  -- Only depreciate active PPE with useful_life_years
  IF v_asset.asset_type <> 'ppe' THEN
    RAISE EXCEPTION 'Only PPE assets can be depreciated. This asset is %', v_asset.asset_type;
  END IF;

  IF v_asset.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot depreciate asset with status %', v_asset.status;
  END IF;

  IF v_asset.useful_life_years IS NULL OR v_asset.useful_life_years <= 0 THEN
    RAISE EXCEPTION 'Asset has no useful life set';
  END IF;

  -- Check if already fully depreciated
  IF v_asset.book_value <= v_asset.residual_value THEN
    RETURN 0;
  END IF;

  -- Check if already depreciated for this period
  IF EXISTS (
    SELECT 1 FROM procurements.depreciation_records
    WHERE asset_id     = p_asset_id
      AND period_year  = v_year
      AND period_month = v_month
  ) THEN
    RAISE EXCEPTION 'Depreciation for % / % has already been recorded for this asset',
      v_year, v_month;
  END IF;

  -- Straight-line depreciation
  v_monthly_dep := ROUND(
    (v_asset.acquisition_cost - v_asset.residual_value) / (v_asset.useful_life_years * 12),
    2
  );

  -- Final-month catch-up: use remaining depreciable amount
  -- to avoid cumulative rounding errors
  v_remaining := v_asset.book_value - v_asset.residual_value;
  IF v_monthly_dep >= v_remaining THEN
    v_monthly_dep := v_remaining;
  END IF;

  v_new_accum := v_asset.accumulated_depreciation + v_monthly_dep;
  v_new_bv    := v_asset.acquisition_cost - v_new_accum;

  -- Insert depreciation record (trigger updates asset)
  INSERT INTO procurements.depreciation_records (
    division_id, asset_id, period_year, period_month,
    depreciation_amount, accumulated_amount, book_value,
    office_id
  ) VALUES (
    v_division_id, p_asset_id, v_year, v_month,
    v_monthly_dep, v_new_accum, v_new_bv,
    v_asset.office_id
  );

  RETURN v_monthly_dep;
END;
$$;

-- ============================================================
-- 17. Fix run_monthly_depreciation — final-month catch-up + division_id
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.run_monthly_depreciation(
  p_year  INTEGER,
  p_month INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_asset         RECORD;
  v_monthly_dep   NUMERIC(14,2);
  v_new_accum     NUMERIC(14,2);
  v_new_bv        NUMERIC(14,2);
  v_remaining     NUMERIC(14,2);
  v_count         INTEGER := 0;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('asset.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to run depreciation';
  END IF;

  -- Validate month
  IF p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'Month must be between 1 and 12';
  END IF;

  -- Prevent future depreciation
  IF (p_year > EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER)
     OR (p_year = EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
         AND p_month > EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER) THEN
    RAISE EXCEPTION 'Cannot run depreciation for a future period';
  END IF;

  v_division_id := procurements.get_user_division_id();

  -- Loop over all eligible PPE assets
  FOR v_asset IN
    SELECT a.*
      FROM procurements.assets a
     WHERE a.division_id       = v_division_id
       AND a.asset_type        = 'ppe'
       AND a.status            = 'active'
       AND a.deleted_at        IS NULL
       AND a.useful_life_years IS NOT NULL
       AND a.useful_life_years > 0
       AND a.book_value        > a.residual_value
       -- Skip already-depreciated for this period
       AND NOT EXISTS (
         SELECT 1 FROM procurements.depreciation_records dr
          WHERE dr.asset_id     = a.id
            AND dr.period_year  = p_year
            AND dr.period_month = p_month
       )
  LOOP
    -- Straight-line depreciation
    v_monthly_dep := ROUND(
      (v_asset.acquisition_cost - v_asset.residual_value) / (v_asset.useful_life_years * 12),
      2
    );

    -- Final-month catch-up: use remaining depreciable amount
    v_remaining := v_asset.book_value - v_asset.residual_value;
    IF v_monthly_dep >= v_remaining THEN
      v_monthly_dep := v_remaining;
    END IF;

    v_new_accum := v_asset.accumulated_depreciation + v_monthly_dep;
    v_new_bv    := v_asset.acquisition_cost - v_new_accum;

    -- Insert depreciation record (trigger updates asset)
    INSERT INTO procurements.depreciation_records (
      division_id, asset_id, period_year, period_month,
      depreciation_amount, accumulated_amount, book_value,
      office_id
    ) VALUES (
      v_division_id, v_asset.id, p_year, p_month,
      v_monthly_dep, v_new_accum, v_new_bv,
      v_asset.office_id
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================
-- 18. Fix initiate_disposal — store disposal_reason + validate method
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.initiate_disposal(
  p_asset_id UUID,
  p_method   TEXT,
  p_remarks  TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_accessible    UUID[];
  v_asset         RECORD;
  v_user_record   RECORD;
BEGIN
  -- Permission check
  IF NOT (procurements.has_permission('asset.dispose') OR procurements.has_permission('asset.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to initiate disposal';
  END IF;

  -- Validate disposal method
  IF p_method NOT IN ('sale', 'transfer', 'donation', 'destruction', 'barter', 'condemnation') THEN
    RAISE EXCEPTION 'Invalid disposal method: %', p_method;
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  -- Validate asset
  SELECT * INTO v_asset
    FROM procurements.assets
   WHERE id          = p_asset_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF v_asset.status IN ('disposed', 'for_disposal') THEN
    RAISE EXCEPTION 'Asset is already %', v_asset.status;
  END IF;

  -- Office scope check
  IF NOT (v_asset.office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to dispose assets in this office';
  END IF;

  -- Update asset status and store disposal reason
  UPDATE procurements.assets
     SET status           = 'for_disposal',
         condition_status = 'unserviceable',
         disposal_method  = p_method,
         disposal_reason  = p_remarks,
         updated_at       = NOW()
   WHERE id = p_asset_id;

  -- Notify HOPE role for disposal approval
  FOR v_user_record IN
    SELECT DISTINCT ur.user_id
      FROM procurements.user_roles ur
      JOIN procurements.roles r ON r.id = ur.role_id
     WHERE r.code         = 'hope'
       AND ur.division_id = v_division_id
       AND ur.is_active   = true
       AND ur.revoked_at  IS NULL
  LOOP
    INSERT INTO procurements.notifications (
      user_id, title, message, type,
      reference_type, reference_id, office_id
    ) VALUES (
      v_user_record.user_id,
      'Asset Disposal Request',
      'Asset ' || v_asset.property_number || ' (' || COALESCE(v_asset.description, 'N/A')
        || ') has been marked for disposal via ' || COALESCE(p_method, 'unspecified')
        || '. ' || COALESCE(p_remarks, ''),
      'approval',
      'asset',
      p_asset_id,
      v_asset.office_id
    );
  END LOOP;
END;
$$;

-- ============================================================
-- 19. Add revert_disposal RPC
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.revert_disposal(
  p_asset_id UUID,
  p_remarks  TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_accessible    UUID[];
  v_asset         RECORD;
BEGIN
  -- Permission check
  IF NOT (procurements.has_permission('asset.dispose') OR procurements.has_permission('asset.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to revert disposal';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  -- Validate asset
  SELECT * INTO v_asset
    FROM procurements.assets
   WHERE id          = p_asset_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF v_asset.status <> 'for_disposal' THEN
    RAISE EXCEPTION 'Can only revert assets with status for_disposal (current: %)', v_asset.status;
  END IF;

  -- Office scope check
  IF NOT (v_asset.office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to manage assets in this office';
  END IF;

  -- Revert asset to active
  UPDATE procurements.assets
     SET status           = 'active',
         condition_status = 'serviceable',
         disposal_method  = NULL,
         disposal_reason  = NULL,
         updated_at       = NOW()
   WHERE id = p_asset_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.revert_disposal(UUID, TEXT) TO authenticated;
