-- Phase 11: Purchase Orders & Delivery — RLS Policies
-- No new permissions needed; po.create, po.approve, delivery.inspect
-- already seeded in 20240304_permissions_seed.sql + 20240305_role_permissions_seed.sql

-- ============================================================
-- 1. purchase_orders
-- ============================================================

-- All division members can view purchase orders
CREATE POLICY "division_read_purchase_orders" ON procurements.purchase_orders
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- Supply Officer / BAC Secretariat can create POs
CREATE POLICY "create_purchase_order" ON procurements.purchase_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('po.create')
      OR procurements.has_permission('proc.manage')
    )
    AND procurements.is_division_active()
  );

-- Authorized roles can update POs (approve, issue, status changes)
CREATE POLICY "update_purchase_order" ON procurements.purchase_orders
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      procurements.has_permission('po.create')
      OR procurements.has_permission('po.approve')
      OR procurements.has_permission('proc.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- ============================================================
-- 2. po_items (access via parent purchase_order)
-- ============================================================

-- Division members can view PO items
CREATE POLICY "division_read_po_items" ON procurements.po_items
  FOR SELECT TO authenticated
  USING (
    purchase_order_id IN (
      SELECT id FROM procurements.purchase_orders
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
  );

-- Authorized roles can manage PO items
CREATE POLICY "manage_po_items" ON procurements.po_items
  FOR ALL TO authenticated
  USING (
    purchase_order_id IN (
      SELECT id FROM procurements.purchase_orders
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
    AND (
      procurements.has_permission('po.create')
      OR procurements.has_permission('proc.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    purchase_order_id IN (
      SELECT id FROM procurements.purchase_orders
      WHERE division_id = procurements.get_user_division_id()
    )
  );

-- ============================================================
-- 3. deliveries (access via parent purchase_order)
-- ============================================================

-- Division members can view deliveries
CREATE POLICY "division_read_deliveries" ON procurements.deliveries
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- Supply Officer / authorized can record deliveries
CREATE POLICY "create_delivery" ON procurements.deliveries
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('po.create')
      OR procurements.has_permission('delivery.inspect')
      OR procurements.has_permission('proc.manage')
    )
    AND procurements.is_division_active()
  );

-- IAC / Supply Officer can update deliveries (inspection results)
CREATE POLICY "update_delivery" ON procurements.deliveries
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      procurements.has_permission('delivery.inspect')
      OR procurements.has_permission('po.create')
      OR procurements.has_permission('proc.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- ============================================================
-- 4. delivery_items (access via deliveries → purchase_orders)
-- ============================================================

-- Division members can view delivery items
CREATE POLICY "division_read_delivery_items" ON procurements.delivery_items
  FOR SELECT TO authenticated
  USING (
    delivery_id IN (
      SELECT d.id FROM procurements.deliveries d
      WHERE d.division_id = procurements.get_user_division_id()
        AND d.deleted_at IS NULL
    )
  );

-- Authorized roles can manage delivery items
CREATE POLICY "manage_delivery_items" ON procurements.delivery_items
  FOR ALL TO authenticated
  USING (
    delivery_id IN (
      SELECT d.id FROM procurements.deliveries d
      WHERE d.division_id = procurements.get_user_division_id()
        AND d.deleted_at IS NULL
    )
    AND (
      procurements.has_permission('po.create')
      OR procurements.has_permission('delivery.inspect')
      OR procurements.has_permission('proc.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    delivery_id IN (
      SELECT d.id FROM procurements.deliveries d
      WHERE d.division_id = procurements.get_user_division_id()
    )
  );
