-- Phase 5: PPMP RLS policies and permission seeds

-- ============================================================
-- Seed permissions for the planning module
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('ppmp.create',        'planning', 'Create PPMP',                                'division'),
  ('ppmp.edit',          'planning', 'Edit draft PPMP projects',                    'division'),
  ('ppmp.submit',        'planning', 'Submit PPMP for review',                      'division'),
  ('ppmp.chief_review',  'planning', 'Review PPMP as Section Chief / School Head',  'division'),
  ('ppmp.certify_budget','planning', 'Certify budget availability for PPMP',        'division'),
  ('ppmp.approve',       'planning', 'Final PPMP approval (HOPE)',                  'division'),
  ('ppmp.return',        'planning', 'Return PPMP to previous step',                'division'),
  ('ppmp.amend',         'planning', 'Initiate PPMP amendment',                     'division')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------
-- Assign permissions to roles
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

CREATE POLICY "division_read_ppmps" ON procurements.ppmps
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "end_user_create_ppmp" ON procurements.ppmps
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('ppmp.create')
    AND procurements.is_division_active()
  );

CREATE POLICY "end_user_update_ppmp" ON procurements.ppmps
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND status = 'draft'
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

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

CREATE POLICY "division_read_ppmp_versions" ON procurements.ppmp_versions
  FOR SELECT TO authenticated
  USING (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
  );

CREATE POLICY "system_manage_ppmp_versions" ON procurements.ppmp_versions
  FOR ALL TO authenticated
  USING (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
  );

-- ============================================================
-- RLS Policies: procurements.ppmp_projects
-- ============================================================

CREATE POLICY "division_read_ppmp_projects" ON procurements.ppmp_projects
  FOR SELECT TO authenticated
  USING (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
    AND deleted_at IS NULL
  );

CREATE POLICY "end_user_manage_ppmp_projects" ON procurements.ppmp_projects
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

-- ============================================================
-- RLS Policies: procurements.ppmp_lots
-- Lots inherit access through their parent project.
-- ============================================================

CREATE POLICY "division_read_ppmp_lots" ON procurements.ppmp_lots
  FOR SELECT TO authenticated
  USING (
    ppmp_project_id IN (
      SELECT pp.id FROM procurements.ppmp_projects pp
      WHERE pp.office_id IN (
        SELECT id FROM procurements.offices
        WHERE division_id = procurements.get_user_division_id()
      )
      AND pp.deleted_at IS NULL
    )
  );

CREATE POLICY "end_user_manage_ppmp_lots" ON procurements.ppmp_lots
  FOR ALL TO authenticated
  USING (
    ppmp_project_id IN (
      SELECT pp.id FROM procurements.ppmp_projects pp
      WHERE (
        pp.created_by = auth.uid()
        OR procurements.has_permission('ppmp.edit')
      )
      AND pp.office_id IN (
        SELECT id FROM procurements.offices
        WHERE division_id = procurements.get_user_division_id()
      )
    )
  );

-- ============================================================
-- RLS Policies: procurements.ppmp_lot_items
-- Items inherit access through their parent lot → project.
-- ============================================================

CREATE POLICY "division_read_ppmp_lot_items" ON procurements.ppmp_lot_items
  FOR SELECT TO authenticated
  USING (
    ppmp_lot_id IN (
      SELECT pl.id FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
      WHERE pp.office_id IN (
        SELECT id FROM procurements.offices
        WHERE division_id = procurements.get_user_division_id()
      )
      AND pp.deleted_at IS NULL
    )
  );

CREATE POLICY "end_user_manage_ppmp_lot_items" ON procurements.ppmp_lot_items
  FOR ALL TO authenticated
  USING (
    ppmp_lot_id IN (
      SELECT pl.id FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
      WHERE (
        pp.created_by = auth.uid()
        OR procurements.has_permission('ppmp.edit')
      )
      AND pp.office_id IN (
        SELECT id FROM procurements.offices
        WHERE division_id = procurements.get_user_division_id()
      )
    )
  );
