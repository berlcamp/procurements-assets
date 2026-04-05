-- Phase 7: Procurement Core — Permissions + RLS policies

-- ============================================================
-- 1. New permissions (those already seeded in 20240304 are skipped)
-- ============================================================
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('pr.view',            'procurement', 'View Purchase Requests in division',       'division'),
  ('pr.edit_own',        'procurement', 'Edit own draft Purchase Requests',         'division'),
  ('pr.submit',          'procurement', 'Submit PR for budget certification',        'division'),
  ('pr.certify',         'procurement', 'Certify fund availability and create OBR', 'division'),
  ('pr.cancel',          'procurement', 'Cancel Purchase Requests',                 'division'),
  ('supplier.view',      'procurement', 'View supplier registry',                   'division'),
  ('supplier.manage',    'procurement', 'Create and manage suppliers',              'division'),
  ('supplier.blacklist', 'procurement', 'Blacklist or suspend suppliers',           'division'),
  ('obr.view',           'procurement', 'View Obligation Requests',                 'division'),
  ('obr.certify',        'procurement', 'Certify Obligation Requests',              'division')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. Role-permission assignments for new permissions
-- ============================================================
CREATE OR REPLACE FUNCTION procurements._seed_procurement_permissions()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_role_id UUID;
  v_perm_id UUID;
  v_assignments TEXT[][] := ARRAY[
    -- pr.view: all division roles
    ARRAY['division_admin',   'pr.view'],
    ARRAY['hope',             'pr.view'],
    ARRAY['division_chief',   'pr.view'],
    ARRAY['section_chief',    'pr.view'],
    ARRAY['budget_officer',   'pr.view'],
    ARRAY['supply_officer',   'pr.view'],
    ARRAY['bac_chair',        'pr.view'],
    ARRAY['bac_member',       'pr.view'],
    ARRAY['bac_secretariat',  'pr.view'],
    ARRAY['end_user',         'pr.view'],
    ARRAY['school_head',      'pr.view'],
    ARRAY['auditor',          'pr.view'],
    ARRAY['accountant',       'pr.view'],
    -- pr.edit_own: End User can edit their own draft PRs
    ARRAY['end_user',         'pr.edit_own'],
    ARRAY['school_head',      'pr.edit_own'],
    ARRAY['division_admin',   'pr.edit_own'],
    -- pr.submit
    ARRAY['end_user',         'pr.submit'],
    ARRAY['school_head',      'pr.submit'],
    ARRAY['supply_officer',   'pr.submit'],
    ARRAY['bac_secretariat',  'pr.submit'],
    ARRAY['division_admin',   'pr.submit'],
    -- pr.certify: Budget Officer certifies fund availability
    ARRAY['budget_officer',   'pr.certify'],
    ARRAY['division_admin',   'pr.certify'],
    -- pr.cancel
    ARRAY['end_user',         'pr.cancel'],
    ARRAY['school_head',      'pr.cancel'],
    ARRAY['hope',             'pr.cancel'],
    ARRAY['division_chief',   'pr.cancel'],
    ARRAY['division_admin',   'pr.cancel'],
    -- supplier.view: all division roles
    ARRAY['division_admin',   'supplier.view'],
    ARRAY['hope',             'supplier.view'],
    ARRAY['division_chief',   'supplier.view'],
    ARRAY['section_chief',    'supplier.view'],
    ARRAY['budget_officer',   'supplier.view'],
    ARRAY['supply_officer',   'supplier.view'],
    ARRAY['bac_chair',        'supplier.view'],
    ARRAY['bac_member',       'supplier.view'],
    ARRAY['bac_secretariat',  'supplier.view'],
    ARRAY['end_user',         'supplier.view'],
    ARRAY['school_head',      'supplier.view'],
    ARRAY['auditor',          'supplier.view'],
    -- supplier.manage: Supply Officer and admin
    ARRAY['supply_officer',   'supplier.manage'],
    ARRAY['bac_secretariat',  'supplier.manage'],
    ARRAY['division_admin',   'supplier.manage'],
    -- supplier.blacklist
    ARRAY['supply_officer',   'supplier.blacklist'],
    ARRAY['hope',             'supplier.blacklist'],
    ARRAY['division_admin',   'supplier.blacklist'],
    -- obr.view
    ARRAY['budget_officer',   'obr.view'],
    ARRAY['hope',             'obr.view'],
    ARRAY['division_chief',   'obr.view'],
    ARRAY['division_admin',   'obr.view'],
    ARRAY['auditor',          'obr.view'],
    ARRAY['accountant',       'obr.view'],
    ARRAY['supply_officer',   'obr.view'],
    -- obr.certify: Budget Officer certifies OBRs
    ARRAY['budget_officer',   'obr.certify'],
    ARRAY['division_admin',   'obr.certify']
  ];
  v_pair TEXT[];
BEGIN
  FOREACH v_pair SLICE 1 IN ARRAY v_assignments
  LOOP
    SELECT id INTO v_role_id FROM procurements.roles WHERE name = v_pair[1];
    SELECT id INTO v_perm_id FROM procurements.permissions WHERE code = v_pair[2];
    IF v_role_id IS NOT NULL AND v_perm_id IS NOT NULL THEN
      INSERT INTO procurements.role_permissions (role_id, permission_id)
      VALUES (v_role_id, v_perm_id)
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

SELECT procurements._seed_procurement_permissions();
DROP FUNCTION procurements._seed_procurement_permissions();

-- ============================================================
-- 3. RLS policies
-- ============================================================

-- ------------------------------------------------------------
-- suppliers
-- ------------------------------------------------------------

-- All division members can view active suppliers
CREATE POLICY "division_read_suppliers" ON procurements.suppliers
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- Supply Officer / admin can manage (insert, update) suppliers
CREATE POLICY "supply_officer_insert_suppliers" ON procurements.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('supplier.manage')
    AND procurements.is_division_active()
  );

CREATE POLICY "supply_officer_update_suppliers" ON procurements.suppliers
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('supplier.manage')
      OR procurements.has_permission('supplier.blacklist')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- Soft-delete only (via UPDATE setting deleted_at)
-- Hard-delete blocked: no DELETE policy created

-- ------------------------------------------------------------
-- purchase_requests
-- ------------------------------------------------------------

-- All division members can view PRs (not deleted)
CREATE POLICY "division_read_prs" ON procurements.purchase_requests
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- End User / authorized roles can create PRs
CREATE POLICY "create_pr" ON procurements.purchase_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('pr.create')
    AND procurements.is_division_active()
  );

-- Update allowed for: owner editing draft, budget officer certifying, approver approving, admin
CREATE POLICY "update_pr" ON procurements.purchase_requests
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      (created_by = auth.uid() AND procurements.has_permission('pr.edit_own'))
      OR procurements.has_permission('pr.certify')
      OR procurements.has_permission('pr.approve')
      OR procurements.has_permission('pr.cancel')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- ------------------------------------------------------------
-- pr_items
-- ------------------------------------------------------------

-- Division members can view items of PRs in their division
CREATE POLICY "division_read_pr_items" ON procurements.pr_items
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND purchase_request_id IN (
      SELECT id FROM procurements.purchase_requests
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
  );

-- Owner of a draft PR can manage its items
CREATE POLICY "owner_manage_pr_items" ON procurements.pr_items
  FOR ALL TO authenticated
  USING (
    purchase_request_id IN (
      SELECT id FROM procurements.purchase_requests
      WHERE division_id  = procurements.get_user_division_id()
        AND created_by   = auth.uid()
        AND status       = 'draft'
        AND deleted_at   IS NULL
    )
  )
  WITH CHECK (
    purchase_request_id IN (
      SELECT id FROM procurements.purchase_requests
      WHERE division_id  = procurements.get_user_division_id()
        AND created_by   = auth.uid()
        AND status       = 'draft'
        AND deleted_at   IS NULL
    )
  );

-- ------------------------------------------------------------
-- obligation_requests
-- ------------------------------------------------------------

-- Authorized division roles can view OBRs
CREATE POLICY "division_read_obrs" ON procurements.obligation_requests
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      procurements.has_permission('obr.view')
      OR platform.is_super_admin()
    )
  );

-- Budget Officer manages OBRs (create + update via RPC which uses SECURITY DEFINER)
-- Direct INSERT/UPDATE blocked for non-admins; all writes go through RPCs
CREATE POLICY "budget_officer_manage_obrs" ON procurements.obligation_requests
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('obr.certify')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('obr.certify')
      OR platform.is_super_admin()
    )
  );
