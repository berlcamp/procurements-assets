-- Phase 12: Asset Management (Inventory) — Triggers
-- 1. Stock movement → inventory quantity sync
-- 2. Reorder point alert notifications

-- ============================================================
-- 1. trg_stock_movement_update_inventory
--
-- On INSERT into stock_movements, update the parent inventory
-- record's current_quantity based on movement type:
--   stock_in, transfer_in, return → add quantity
--   stock_out, transfer_out       → subtract quantity
--   adjustment                    → apply directly (+/-)
--
-- The inventory table has CHECK (current_quantity >= 0) as a
-- safeguard, but we also validate explicitly here.
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
      -- Adjustment quantity is signed: positive = add, negative = subtract
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

  -- Validate non-negative (belt-and-suspenders with CHECK constraint)
  IF v_new_quantity < 0 THEN
    RAISE EXCEPTION 'Insufficient stock: operation would result in negative quantity (%).',
      v_new_quantity;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stock_movement_update_inventory
  AFTER INSERT ON procurements.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION procurements.update_inventory_from_movement();

-- ============================================================
-- 2. trg_stock_movement_reorder_alert
--
-- After a stock movement, if the inventory's current_quantity
-- has dropped to or below its reorder_point (and reorder_point
-- is set > 0), insert notifications for users with the
-- 'inventory.manage' permission in the relevant office.
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

  -- Notify users with inventory.manage permission in this office/division
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
         -- Division-wide roles or roles in the same office
         ur.office_id IS NULL
         OR ur.office_id = v_inv.office_id
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

CREATE TRIGGER trg_stock_movement_reorder_alert
  AFTER INSERT ON procurements.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION procurements.check_reorder_alert();
