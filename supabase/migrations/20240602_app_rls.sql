-- Phase 6: APP RLS policies and permission seeds

-- ============================================================
-- Seed permissions for the APP module
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('app.view',             'planning', 'View APP',                                    'division'),
  ('app.manage',           'planning', 'Manage APP (create/edit)',                     'division'),
  ('app.hope_review',      'planning', 'Review individual APP items (HOPE)',           'division'),
  ('app.bac_manage_lots',  'planning', 'Create and manage BAC lots',                   'division'),
  ('app.bac_finalize_lot', 'planning', 'Finalize BAC lots',                            'division'),
  ('app.finalize',         'planning', 'Finalize APP (mark as FINAL)',                 'division'),
  ('app.approve',          'planning', 'Final APP approval (HOPE)',                    'division'),
  ('app.amend',            'planning', 'Initiate APP amendment',                       'division')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------
-- Assign permissions to roles
-- ---------------------------------------------------------------

-- end_user: view only
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'end_user'
  AND p.code IN ('app.view')
ON CONFLICT DO NOTHING;

-- budget_officer: view
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'budget_officer'
  AND p.code IN ('app.view')
ON CONFLICT DO NOTHING;

-- hope: review items, finalize, approve
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'hope'
  AND p.code IN ('app.view','app.hope_review','app.finalize','app.approve')
ON CONFLICT DO NOTHING;

-- bac_chair: lot management
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'bac_chair'
  AND p.code IN ('app.view','app.bac_manage_lots','app.bac_finalize_lot')
ON CONFLICT DO NOTHING;

-- bac_member: lot management (view + manage)
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'bac_member'
  AND p.code IN ('app.view','app.bac_manage_lots')
ON CONFLICT DO NOTHING;

-- bac_secretariat: lot management
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'bac_secretariat'
  AND p.code IN ('app.view','app.bac_manage_lots','app.bac_finalize_lot')
ON CONFLICT DO NOTHING;

-- division_admin: all app.* permissions
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'division_admin'
  AND p.code IN (
    'app.view',
    'app.manage',
    'app.hope_review',
    'app.bac_manage_lots',
    'app.bac_finalize_lot',
    'app.finalize',
    'app.approve',
    'app.amend'
  )
ON CONFLICT DO NOTHING;

-- auditor: view only
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'auditor'
  AND p.code IN ('app.view')
ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS Policies: procurements.apps
-- ============================================================

CREATE POLICY "division_read_apps" ON procurements.apps
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "division_admin_manage_apps" ON procurements.apps
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('app.manage')
      OR procurements.has_permission('app.approve')
      OR platform.is_super_admin()
    )
  );

-- ============================================================
-- RLS Policies: procurements.app_versions
-- ============================================================

CREATE POLICY "division_read_app_versions" ON procurements.app_versions
  FOR SELECT TO authenticated
  USING (
    app_id IN (
      SELECT id FROM procurements.apps
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
  );

CREATE POLICY "division_admin_manage_app_versions" ON procurements.app_versions
  FOR ALL TO authenticated
  USING (
    app_id IN (
      SELECT id FROM procurements.apps
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
    AND (
      procurements.has_permission('app.manage')
      OR procurements.has_permission('app.approve')
      OR platform.is_super_admin()
    )
  );

-- ============================================================
-- RLS Policies: procurements.app_items
-- ============================================================

CREATE POLICY "division_read_app_items" ON procurements.app_items
  FOR SELECT TO authenticated
  USING (
    app_id IN (
      SELECT id FROM procurements.apps
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
    AND deleted_at IS NULL
  );

CREATE POLICY "division_admin_manage_app_items" ON procurements.app_items
  FOR ALL TO authenticated
  USING (
    app_id IN (
      SELECT id FROM procurements.apps
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
    AND (
      procurements.has_permission('app.manage')
      OR procurements.has_permission('app.hope_review')
      OR procurements.has_permission('app.approve')
      OR platform.is_super_admin()
    )
  );

-- ============================================================
-- RLS Policies: procurements.app_lots
-- ============================================================

CREATE POLICY "division_read_app_lots" ON procurements.app_lots
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "bac_manage_app_lots" ON procurements.app_lots
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('app.bac_manage_lots')
      OR procurements.has_permission('app.approve')
      OR platform.is_super_admin()
    )
  );
