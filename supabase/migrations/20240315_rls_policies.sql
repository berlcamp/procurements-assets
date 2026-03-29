-- Phase 3: RLS policies — two-layer isolation (division wall + role-based) + subscription enforcement

-- Enable RLS on all Phase 3 tables
ALTER TABLE procurements.offices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.user_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.user_roles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.system_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sequence_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.approval_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_logs              ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ROLES & PERMISSIONS (read-only lookup for authenticated users)
-- ============================================================

CREATE POLICY "authenticated_read_roles" ON procurements.roles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_permissions" ON procurements.permissions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_role_permissions" ON procurements.role_permissions
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- OFFICES — Layer 1: division isolation
-- ============================================================

-- Division Admin / HOPE can manage offices within their division
CREATE POLICY "division_manage_offices" ON procurements.offices
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('offices.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('offices.manage')
    AND procurements.is_division_active()
  );

-- All authenticated users in the same division can read offices
CREATE POLICY "division_read_offices" ON procurements.offices
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- ============================================================
-- USER_PROFILES — Layer 1: division isolation
-- ============================================================

-- Division Admin manages users within their division
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
    AND procurements.has_permission('users.manage')
    AND procurements.is_division_active()
  );

-- Every user can read their own profile
CREATE POLICY "own_user_profile" ON procurements.user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- All division members can see each other's profiles
CREATE POLICY "division_read_user_profiles" ON procurements.user_profiles
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- ============================================================
-- USER_ROLES — Layer 1: division isolation
-- ============================================================

CREATE POLICY "division_manage_user_roles" ON procurements.user_roles
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('roles.assign')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('roles.assign')
    AND procurements.is_division_active()
  );

-- Users can read their own role assignments
CREATE POLICY "own_user_roles" ON procurements.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Division members can see roles within their division
CREATE POLICY "division_read_user_roles" ON procurements.user_roles
  FOR SELECT TO authenticated
  USING (division_id = procurements.get_user_division_id());

-- ============================================================
-- SYSTEM_SETTINGS — Layer 1: division isolation
-- ============================================================

CREATE POLICY "division_manage_settings" ON procurements.system_settings
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('division.settings')
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('division.settings')
    AND procurements.is_division_active()
  );

CREATE POLICY "division_read_settings" ON procurements.system_settings
  FOR SELECT TO authenticated
  USING (division_id = procurements.get_user_division_id());

-- ============================================================
-- SEQUENCE_COUNTERS — division isolation, service-role write
-- ============================================================

CREATE POLICY "division_read_seq_counters" ON procurements.sequence_counters
  FOR SELECT TO authenticated
  USING (division_id = procurements.get_user_division_id());

-- generate_sequence_number is SECURITY DEFINER and handles writes

-- ============================================================
-- NOTIFICATIONS — user owns their own
-- ============================================================

CREATE POLICY "own_notifications" ON procurements.notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- APPROVAL_LOGS — division members can read, inserts via SECURITY DEFINER RPCs
-- ============================================================

CREATE POLICY "division_read_approval_logs" ON procurements.approval_logs
  FOR SELECT TO authenticated
  USING (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
  );

-- ============================================================
-- DOCUMENTS — division isolation via office
-- ============================================================

CREATE POLICY "division_read_documents" ON procurements.documents
  FOR SELECT TO authenticated
  USING (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
    AND deleted_at IS NULL
  );

CREATE POLICY "division_insert_documents" ON procurements.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
    AND procurements.is_division_active()
  );

-- ============================================================
-- AUDIT_LOGS — division Admin and Auditor can read
-- ============================================================

CREATE POLICY "division_read_audit_logs" ON audit.audit_logs
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('division.audit_logs')
  );

-- audit_trigger function is SECURITY DEFINER and handles inserts
