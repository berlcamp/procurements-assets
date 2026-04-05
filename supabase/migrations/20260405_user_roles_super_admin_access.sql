-- Allow super admins to assign/revoke roles for any user in any division.
-- Previously, the USING clause ANDed is_super_admin with the division check,
-- and WITH CHECK omitted is_super_admin entirely — blocking cross-division access.

DROP POLICY IF EXISTS "division_manage_user_roles" ON procurements.user_roles;

CREATE POLICY "division_manage_user_roles" ON procurements.user_roles
  FOR ALL TO authenticated
  USING (
    platform.is_super_admin()
    OR (
      division_id = procurements.get_user_division_id()
      AND procurements.has_permission('roles.assign')
    )
  )
  WITH CHECK (
    platform.is_super_admin()
    OR (
      division_id = procurements.get_user_division_id()
      AND procurements.has_permission('roles.assign')
      AND procurements.is_division_active()
    )
  );
