-- Phase 2: RLS policies

-- Enable RLS
ALTER TABLE platform.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.platform_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.fund_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.account_codes ENABLE ROW LEVEL SECURITY;

-- platform.divisions: Super Admin manages all, authenticated users read their own
CREATE POLICY "super_admin_all_divisions" ON platform.divisions
  FOR ALL
  TO authenticated
  USING (platform.is_super_admin())
  WITH CHECK (platform.is_super_admin());

CREATE POLICY "authenticated_read_own_division" ON platform.divisions
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND id = (
      SELECT (raw_user_meta_data->>'division_id')::UUID
      FROM auth.users
      WHERE id = auth.uid()
    )
  );

-- platform.announcements: Super Admin manages, all authenticated read active
CREATE POLICY "super_admin_all_announcements" ON platform.announcements
  FOR ALL
  TO authenticated
  USING (platform.is_super_admin())
  WITH CHECK (platform.is_super_admin());

CREATE POLICY "authenticated_read_active_announcements" ON platform.announcements
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (
      target_divisions IS NULL
      OR (
        SELECT (raw_user_meta_data->>'division_id')::UUID
        FROM auth.users
        WHERE id = auth.uid()
      ) = ANY(target_divisions)
    )
  );

-- platform.platform_audit_logs: Super Admin reads all, service role inserts
CREATE POLICY "super_admin_read_audit_logs" ON platform.platform_audit_logs
  FOR SELECT
  TO authenticated
  USING (platform.is_super_admin());

-- fund_sources: Super Admin manages, all authenticated read active
CREATE POLICY "super_admin_all_fund_sources" ON procurements.fund_sources
  FOR ALL
  TO authenticated
  USING (platform.is_super_admin())
  WITH CHECK (platform.is_super_admin());

CREATE POLICY "authenticated_read_active_fund_sources" ON procurements.fund_sources
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- account_codes: Super Admin manages, all authenticated read active
CREATE POLICY "super_admin_all_account_codes" ON procurements.account_codes
  FOR ALL
  TO authenticated
  USING (platform.is_super_admin())
  WITH CHECK (platform.is_super_admin());

CREATE POLICY "authenticated_read_active_account_codes" ON procurements.account_codes
  FOR SELECT
  TO authenticated
  USING (is_active = true);
