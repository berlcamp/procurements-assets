-- Fuel Request & Inventory Module — RLS Policies
-- Division isolation + permission-based access for all fuel tables.

-- ============================================================
-- 1. fuel_types — division-wide read, manage requires permission
-- ============================================================

CREATE POLICY "division_read_fuel_types" ON procurements.fuel_types
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "create_fuel_types" ON procurements.fuel_types
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('fuel.manage_inventory')
    AND procurements.is_division_active()
  );

CREATE POLICY "update_fuel_types" ON procurements.fuel_types
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      procurements.has_permission('fuel.manage_inventory')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- ============================================================
-- 2. fuel_inventory — read by division, manage requires permission
-- ============================================================

CREATE POLICY "division_read_fuel_inventory" ON procurements.fuel_inventory
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "create_fuel_inventory" ON procurements.fuel_inventory
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('fuel.manage_inventory')
    AND procurements.is_division_active()
  );

CREATE POLICY "update_fuel_inventory" ON procurements.fuel_inventory
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      procurements.has_permission('fuel.manage_inventory')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- ============================================================
-- 3. fuel_stock_movements — read by division, insert only (immutable)
-- ============================================================

CREATE POLICY "division_read_fuel_stock_movements" ON procurements.fuel_stock_movements
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
  );

CREATE POLICY "create_fuel_stock_movements" ON procurements.fuel_stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('fuel.manage_inventory')
    AND procurements.is_division_active()
  );

-- No UPDATE/DELETE policies — immutable ledger

-- ============================================================
-- 4. fuel_requests — multi-layer SELECT
-- ============================================================

-- Creators see their own requests
CREATE POLICY "creator_read_fuel_requests" ON procurements.fuel_requests
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND requested_by = auth.uid()
  );

-- Fuel managers / approvers see all requests in division
CREATE POLICY "approver_read_fuel_requests" ON procurements.fuel_requests
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND procurements.has_permission('fuel.approve')
  );

-- Inventory managers see all requests in division
CREATE POLICY "manager_read_fuel_requests" ON procurements.fuel_requests
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND procurements.has_permission('fuel.manage_inventory')
  );

-- Report viewers can read fuel requests
CREATE POLICY "reporter_read_fuel_requests" ON procurements.fuel_requests
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND procurements.has_permission('fuel.view_reports')
  );

-- ============================================================
-- 5. fuel_requests — INSERT / UPDATE
-- ============================================================

-- Users with fuel.request can create fuel requests
CREATE POLICY "create_fuel_requests" ON procurements.fuel_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('fuel.request')
    AND procurements.is_division_active()
  );

-- Requesters can update own pending requests (cancel),
-- approvers can update (approve/reject),
-- inventory managers can update (dispense)
CREATE POLICY "update_fuel_requests" ON procurements.fuel_requests
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      requested_by = auth.uid()
      OR procurements.has_permission('fuel.approve')
      OR procurements.has_permission('fuel.manage_inventory')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );
