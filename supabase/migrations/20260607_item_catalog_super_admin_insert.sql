-- Fix: item_catalog INSERT policy was missing the super admin bypass that
-- the UPDATE policy already has. Super admins with a division profile can
-- see the page (usePermissions returns all codes) but the RLS blocked inserts.

DROP POLICY IF EXISTS "create_item_catalog" ON procurements.item_catalog;

CREATE POLICY "create_item_catalog" ON procurements.item_catalog
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('inventory.manage')
      OR procurements.has_permission('asset.manage')
      OR platform.is_super_admin()
    )
    AND procurements.is_division_active()
  );
