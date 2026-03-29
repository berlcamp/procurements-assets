-- Phase 5: PPMP RLS policies and permission seeds

-- ============================================================
-- Seed permissions for the planning module
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('ppmp.create',        'planning', 'Create PPMP',                                'division'),
  ('ppmp.edit',          'planning', 'Edit draft PPMP items',                       'division'),
  ('ppmp.submit',        'planning', 'Submit PPMP for review',                      'division'),
  ('ppmp.chief_review',  'planning', 'Review PPMP as Section Chief / School Head',  'division'),
  ('ppmp.certify_budget','planning', 'Certify budget availability for PPMP',        'division'),
  ('ppmp.approve',       'planning', 'Final PPMP approval (HOPE)',                  'division'),
  ('ppmp.return',        'planning', 'Return PPMP to previous step',                'division'),
  ('ppmp.amend',         'planning', 'Initiate PPMP amendment',                     'division')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------
-- Assign permissions to roles
-- end_user:       create, edit, submit, amend
-- section_chief:  chief_review, return
-- school_head:    chief_review, return
-- budget_officer: certify_budget, return
-- hope:           approve, return
-- division_admin: all ppmp.* permissions
-- auditor:        read-only via SELECT RLS policy (no explicit permission)
-- ---------------------------------------------------------------

-- end_user
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'end_user'
  AND p.code IN ('ppmp.create','ppmp.edit','ppmp.submit','ppmp.amend')
ON CONFLICT DO NOTHING;

-- section_chief
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'section_chief'
  AND p.code IN ('ppmp.chief_review','ppmp.return')
ON CONFLICT DO NOTHING;

-- school_head
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'school_head'
  AND p.code IN ('ppmp.chief_review','ppmp.return')
ON CONFLICT DO NOTHING;

-- budget_officer
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'budget_officer'
  AND p.code IN ('ppmp.certify_budget','ppmp.return')
ON CONFLICT DO NOTHING;

-- hope
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'hope'
  AND p.code IN ('ppmp.approve','ppmp.return')
ON CONFLICT DO NOTHING;

-- division_admin: all ppmp.* permissions
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'division_admin'
  AND p.code IN (
    'ppmp.create',
    'ppmp.edit',
    'ppmp.submit',
    'ppmp.chief_review',
    'ppmp.certify_budget',
    'ppmp.approve',
    'ppmp.return',
    'ppmp.amend'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS Policies: procurements.ppmps
-- ============================================================

-- All division members can read PPMPs in their division
CREATE POLICY "division_read_ppmps" ON procurements.ppmps
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- End users (with ppmp.create) can insert PPMPs for their division
CREATE POLICY "end_user_create_ppmp" ON procurements.ppmps
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('ppmp.create')
    AND procurements.is_division_active()
  );

-- Creators can update their own draft PPMPs
CREATE POLICY "end_user_update_ppmp" ON procurements.ppmps
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND status = 'draft'
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- Division Admin / HOPE: full management within division
CREATE POLICY "division_admin_manage_ppmps" ON procurements.ppmps
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('ppmp.approve')
      OR platform.is_super_admin()
    )
  );

-- ============================================================
-- RLS Policies: procurements.ppmp_versions
-- ============================================================

-- All division members can read PPMP versions in their division
CREATE POLICY "division_read_ppmp_versions" ON procurements.ppmp_versions
  FOR SELECT TO authenticated
  USING (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
  );

-- Versions are managed via SECURITY DEFINER RPCs; office-scoped write access
CREATE POLICY "system_manage_ppmp_versions" ON procurements.ppmp_versions
  FOR ALL TO authenticated
  USING (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
  );

-- ============================================================
-- RLS Policies: procurements.ppmp_items
-- ============================================================

-- All division members can read non-deleted PPMP items in their division
CREATE POLICY "division_read_ppmp_items" ON procurements.ppmp_items
  FOR SELECT TO authenticated
  USING (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
    AND deleted_at IS NULL
  );

-- Creators or users with ppmp.edit can insert/update/delete items
CREATE POLICY "end_user_manage_ppmp_items" ON procurements.ppmp_items
  FOR ALL TO authenticated
  USING (
    (
      created_by = auth.uid()
      OR procurements.has_permission('ppmp.edit')
    )
    AND office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
  )
  WITH CHECK (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
    AND procurements.is_division_active()
  );
