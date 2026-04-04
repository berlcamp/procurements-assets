-- authenticated role cannot SELECT auth.users. Policies that subquery auth.users
-- fail with: permission denied for table users (42501).
-- Use SECURITY DEFINER procurements.get_user_division_id() instead (reads user_profiles).

DROP POLICY IF EXISTS "authenticated_read_own_division" ON platform.divisions;

CREATE POLICY "authenticated_read_own_division" ON platform.divisions
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND id = procurements.get_user_division_id()
  );

DROP POLICY IF EXISTS "authenticated_read_active_announcements" ON platform.announcements;

CREATE POLICY "authenticated_read_active_announcements" ON platform.announcements
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (
      target_divisions IS NULL
      OR procurements.get_user_division_id() = ANY(target_divisions)
    )
  );
