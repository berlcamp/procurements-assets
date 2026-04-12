-- Phase 12: Asset Management (Inventory) — RLS Policies
-- Office-scoped access: division-office supply officers manage all,
-- school-scoped supply officers manage only their school.

-- ============================================================
-- Helper: get_user_accessible_office_ids()
--
-- Returns the set of office IDs the current user can manage.
-- - Division-office users (office_type = 'division_office') → all offices
-- - School/section users → only their own office
-- - Users with asset.manage (division admin) → all offices
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.get_user_accessible_office_ids()
RETURNS UUID[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_office_id   UUID;
  v_user_division_id UUID;
  v_office_type      TEXT;
  v_result           UUID[];
BEGIN
  -- Get user's office and division
  SELECT office_id, division_id
    INTO v_user_office_id, v_user_division_id
    FROM procurements.user_profiles
   WHERE id = auth.uid();

  IF v_user_office_id IS NULL OR v_user_division_id IS NULL THEN
    RETURN ARRAY[]::UUID[];
  END IF;

  -- Check if user has division-wide admin permission
  IF procurements.has_permission('asset.manage') THEN
    SELECT ARRAY_AGG(id) INTO v_result
      FROM procurements.offices
     WHERE division_id = v_user_division_id
       AND deleted_at IS NULL;
    RETURN COALESCE(v_result, ARRAY[]::UUID[]);
  END IF;

  -- Get the user's office type
  SELECT office_type INTO v_office_type
    FROM procurements.offices
   WHERE id = v_user_office_id;

  -- Division-office users see all offices in the division
  IF v_office_type = 'division_office' THEN
    SELECT ARRAY_AGG(id) INTO v_result
      FROM procurements.offices
     WHERE division_id = v_user_division_id
       AND deleted_at IS NULL;
    RETURN COALESCE(v_result, ARRAY[]::UUID[]);
  END IF;

  -- School/section users see only their own office
  RETURN ARRAY[v_user_office_id];
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.get_user_accessible_office_ids() TO authenticated;

-- ============================================================
-- 1. item_catalog — division-wide (shared catalog, no office scoping)
-- ============================================================

-- All division members can view the item catalog
CREATE POLICY "division_read_item_catalog" ON procurements.item_catalog
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- Users with inventory.manage or asset.manage can create catalog items
CREATE POLICY "create_item_catalog" ON procurements.item_catalog
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('inventory.manage')
      OR procurements.has_permission('asset.manage')
    )
    AND procurements.is_division_active()
  );

-- Users with inventory.manage or asset.manage can update catalog items
CREATE POLICY "update_item_catalog" ON procurements.item_catalog
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      procurements.has_permission('inventory.manage')
      OR procurements.has_permission('asset.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- ============================================================
-- 2. inventory — office-scoped via get_user_accessible_office_ids()
-- ============================================================

-- Users can view inventory for their accessible offices
CREATE POLICY "office_read_inventory" ON procurements.inventory
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
  );

-- Users with inventory.manage can create inventory records in accessible offices
CREATE POLICY "create_inventory" ON procurements.inventory
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
    AND procurements.has_permission('inventory.manage')
    AND procurements.is_division_active()
  );

-- Users with inventory.manage can update inventory in accessible offices
CREATE POLICY "update_inventory" ON procurements.inventory
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
    AND (
      procurements.has_permission('inventory.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- ============================================================
-- 3. stock_movements — office-scoped, immutable (no UPDATE/DELETE)
-- ============================================================

-- Users can view movements for their accessible offices
CREATE POLICY "office_read_stock_movements" ON procurements.stock_movements
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
  );

-- Users with inventory.manage can insert movements for accessible offices
-- (Primary inserts happen via SECURITY DEFINER RPCs, but policy added for defense-in-depth)
CREATE POLICY "create_stock_movement" ON procurements.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
    AND procurements.has_permission('inventory.manage')
  );

-- No UPDATE or DELETE policies — stock_movements are an immutable ledger
