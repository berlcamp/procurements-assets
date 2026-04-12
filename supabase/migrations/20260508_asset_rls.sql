-- Phase 13: Asset Management (Property) — RLS Policies
-- Office-scoped access via get_user_accessible_office_ids() for managers.
-- Custodians see their own assets via asset.view_own permission.

-- ============================================================
-- 1. assets — office-scoped + custodian self-access
-- ============================================================

-- Users with asset.manage see assets in their accessible offices
CREATE POLICY "office_read_assets" ON procurements.assets
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
  );

-- Custodians can view their own assigned assets (any office in division)
CREATE POLICY "custodian_read_own_assets" ON procurements.assets
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND current_custodian_id = auth.uid()
    AND procurements.has_permission('asset.view_own')
  );

-- Users with asset.manage can register assets in accessible offices
CREATE POLICY "create_assets" ON procurements.assets
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
    AND procurements.has_permission('asset.manage')
    AND procurements.is_division_active()
  );

-- Users with asset.manage can update assets in accessible offices
CREATE POLICY "update_assets" ON procurements.assets
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
    AND (
      procurements.has_permission('asset.manage')
      OR procurements.has_permission('asset.dispose')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- ============================================================
-- 2. asset_assignments — office-scoped
-- ============================================================

-- Users can view assignments in their accessible offices
CREATE POLICY "office_read_asset_assignments" ON procurements.asset_assignments
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
  );

-- Custodians can view their own assignments
CREATE POLICY "custodian_read_own_assignments" ON procurements.asset_assignments
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND custodian_id = auth.uid()
    AND procurements.has_permission('asset.view_own')
  );

-- Users with asset.assign or asset.manage can create assignments
CREATE POLICY "create_asset_assignments" ON procurements.asset_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
    AND (
      procurements.has_permission('asset.assign')
      OR procurements.has_permission('asset.manage')
    )
    AND procurements.is_division_active()
  );

-- Users with asset.assign or asset.manage can update assignments (return, close)
CREATE POLICY "update_asset_assignments" ON procurements.asset_assignments
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
    AND (
      procurements.has_permission('asset.assign')
      OR procurements.has_permission('asset.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- ============================================================
-- 3. depreciation_records — office-scoped, immutable (no UPDATE/DELETE)
-- ============================================================

-- Users can view depreciation records for their accessible offices
CREATE POLICY "office_read_depreciation" ON procurements.depreciation_records
  FOR SELECT TO authenticated
  USING (
    office_id = ANY(procurements.get_user_accessible_office_ids())
  );

-- Users with asset.manage can insert depreciation records
-- (Primary inserts happen via SECURITY DEFINER RPCs, but policy added for defense-in-depth)
CREATE POLICY "create_depreciation" ON procurements.depreciation_records
  FOR INSERT TO authenticated
  WITH CHECK (
    office_id = ANY(procurements.get_user_accessible_office_ids())
    AND procurements.has_permission('asset.manage')
  );

-- No UPDATE or DELETE policies — depreciation_records are an immutable ledger
