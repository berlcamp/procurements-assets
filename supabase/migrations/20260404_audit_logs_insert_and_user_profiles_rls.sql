-- Fix: audit_trigger() INSERT into audit.audit_logs failed because RLS allowed only SELECT.
-- The trigger runs in the invoker session; rows use user_id = auth.uid().
-- Also align user_profiles division_manage WITH CHECK with USING (super admin could pass USING but fail WITH CHECK).

DROP POLICY IF EXISTS "division_manage_user_profiles" ON procurements.user_profiles;

CREATE POLICY "division_manage_user_profiles" ON procurements.user_profiles
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('users.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('users.manage')
      OR platform.is_super_admin()
    )
    AND procurements.is_division_active()
  );

DROP POLICY IF EXISTS "audit_logs_insert_own_actor" ON audit.audit_logs;

CREATE POLICY "audit_logs_insert_own_actor" ON audit.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
