-- Phase 3: role_permissions table with full matrix seed
CREATE TABLE IF NOT EXISTS procurements.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES procurements.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES procurements.permissions(id) ON DELETE CASCADE,
  UNIQUE (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role ON procurements.role_permissions(role_id);
CREATE INDEX idx_role_permissions_perm ON procurements.role_permissions(permission_id);

-- Helper function for seeding (drops itself after use)
CREATE OR REPLACE FUNCTION procurements._seed_role_permissions()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_role_id UUID;
  v_perm_id UUID;

  -- Role UUIDs
  r_div_admin    UUID;
  r_hope         UUID;
  r_div_chief    UUID;
  r_sect_chief   UUID;
  r_budget_off   UUID;
  r_supply_off   UUID;
  r_bac_chair    UUID;
  r_bac_member   UUID;
  r_bac_sec      UUID;
  r_iac          UUID;
  r_end_user     UUID;
  r_school_head  UUID;
  r_auditor      UUID;
  r_accountant   UUID;

  -- Role assignment: (role_name, permission_code)[]
  v_assignments TEXT[][] := ARRAY[
    -- Planning permissions
    ARRAY['division_admin',  'ppmp.create'],
    ARRAY['end_user',        'ppmp.create'],
    ARRAY['division_admin',  'ppmp.edit'],
    ARRAY['end_user',        'ppmp.edit'],
    ARRAY['division_admin',  'ppmp.submit'],
    ARRAY['end_user',        'ppmp.submit'],
    ARRAY['division_admin',  'ppmp.review_chief'],
    ARRAY['section_chief',   'ppmp.review_chief'],
    ARRAY['school_head',     'ppmp.review_chief'],
    ARRAY['division_admin',  'ppmp.certify'],
    ARRAY['budget_officer',  'ppmp.certify'],
    ARRAY['division_admin',  'ppmp.approve'],
    ARRAY['hope',            'ppmp.approve'],
    ARRAY['division_admin',  'ppmp.view_all'],
    ARRAY['hope',            'ppmp.view_all'],
    ARRAY['division_chief',  'ppmp.view_all'],
    ARRAY['section_chief',   'ppmp.view_all'],
    ARRAY['budget_officer',  'ppmp.view_all'],
    ARRAY['supply_officer',  'ppmp.view_all'],
    ARRAY['school_head',     'ppmp.view_all'],
    ARRAY['auditor',         'ppmp.view_all'],
    ARRAY['division_admin',  'app.review_rows'],
    ARRAY['hope',            'app.review_rows'],
    ARRAY['division_admin',  'app.finalize_lots'],
    ARRAY['bac_chair',       'app.finalize_lots'],
    ARRAY['bac_member',      'app.finalize_lots'],
    ARRAY['bac_secretariat', 'app.finalize_lots'],
    ARRAY['division_admin',  'app.approve'],
    ARRAY['hope',            'app.approve'],
    -- Budget permissions
    ARRAY['division_admin',  'budget.create'],
    ARRAY['budget_officer',  'budget.create'],
    ARRAY['division_admin',  'budget.adjust'],
    ARRAY['budget_officer',  'budget.adjust'],
    ARRAY['division_admin',  'budget.certify'],
    ARRAY['budget_officer',  'budget.certify'],
    ARRAY['division_admin',  'budget.approve_adj'],
    ARRAY['hope',            'budget.approve_adj'],
    ARRAY['division_chief',  'budget.approve_adj'],
    ARRAY['division_admin',  'budget.view_all'],
    ARRAY['hope',            'budget.view_all'],
    ARRAY['division_chief',  'budget.view_all'],
    ARRAY['section_chief',   'budget.view_all'],
    ARRAY['budget_officer',  'budget.view_all'],
    ARRAY['supply_officer',  'budget.view_all'],
    ARRAY['auditor',         'budget.view_all'],
    ARRAY['accountant',      'budget.view_all'],
    -- Procurement permissions
    ARRAY['division_admin',  'pr.create'],
    ARRAY['supply_officer',  'pr.create'],
    ARRAY['bac_secretariat', 'pr.create'],
    ARRAY['end_user',        'pr.create'],
    ARRAY['school_head',     'pr.create'],
    ARRAY['division_admin',  'pr.approve'],
    ARRAY['hope',            'pr.approve'],
    ARRAY['division_chief',  'pr.approve'],
    ARRAY['school_head',     'pr.approve'],
    ARRAY['division_admin',  'proc.manage'],
    ARRAY['supply_officer',  'proc.manage'],
    ARRAY['bac_secretariat', 'proc.manage'],
    ARRAY['division_admin',  'bid.evaluate'],
    ARRAY['bac_chair',       'bid.evaluate'],
    ARRAY['bac_member',      'bid.evaluate'],
    ARRAY['division_admin',  'bid.award'],
    ARRAY['hope',            'bid.award'],
    ARRAY['bac_chair',       'bid.award'],
    ARRAY['division_admin',  'po.create'],
    ARRAY['supply_officer',  'po.create'],
    ARRAY['bac_secretariat', 'po.create'],
    ARRAY['division_admin',  'po.approve'],
    ARRAY['hope',            'po.approve'],
    ARRAY['division_chief',  'po.approve'],
    ARRAY['division_admin',  'delivery.inspect'],
    ARRAY['supply_officer',  'delivery.inspect'],
    ARRAY['iac_member',      'delivery.inspect'],
    -- Asset permissions
    ARRAY['division_admin',  'asset.manage'],
    ARRAY['supply_officer',  'asset.manage'],
    ARRAY['division_admin',  'asset.assign'],
    ARRAY['supply_officer',  'asset.assign'],
    ARRAY['school_head',     'asset.assign'],
    -- asset.view_own: all roles
    ARRAY['division_admin',  'asset.view_own'],
    ARRAY['hope',            'asset.view_own'],
    ARRAY['division_chief',  'asset.view_own'],
    ARRAY['section_chief',   'asset.view_own'],
    ARRAY['budget_officer',  'asset.view_own'],
    ARRAY['supply_officer',  'asset.view_own'],
    ARRAY['bac_chair',       'asset.view_own'],
    ARRAY['bac_member',      'asset.view_own'],
    ARRAY['bac_secretariat', 'asset.view_own'],
    ARRAY['iac_member',      'asset.view_own'],
    ARRAY['property_custodian','asset.view_own'],
    ARRAY['end_user',        'asset.view_own'],
    ARRAY['school_head',     'asset.view_own'],
    ARRAY['auditor',         'asset.view_own'],
    ARRAY['accountant',      'asset.view_own'],
    ARRAY['division_admin',  'asset.dispose'],
    ARRAY['hope',            'asset.dispose'],
    ARRAY['supply_officer',  'asset.dispose'],
    ARRAY['division_admin',  'inventory.manage'],
    ARRAY['supply_officer',  'inventory.manage'],
    -- Request permissions
    ARRAY['division_admin',  'request.create'],
    ARRAY['end_user',        'request.create'],
    ARRAY['school_head',     'request.create'],
    ARRAY['division_admin',  'request.approve'],
    ARRAY['division_chief',  'request.approve'],
    ARRAY['section_chief',   'request.approve'],
    ARRAY['school_head',     'request.approve'],
    ARRAY['division_admin',  'request.process'],
    ARRAY['supply_officer',  'request.process'],
    -- Report permissions
    ARRAY['division_admin',  'reports.all'],
    ARRAY['hope',            'reports.all'],
    ARRAY['division_chief',  'reports.all'],
    ARRAY['auditor',         'reports.all'],
    ARRAY['accountant',      'reports.all'],
    ARRAY['division_admin',  'reports.office'],
    ARRAY['hope',            'reports.office'],
    ARRAY['division_chief',  'reports.office'],
    ARRAY['section_chief',   'reports.office'],
    ARRAY['budget_officer',  'reports.office'],
    ARRAY['supply_officer',  'reports.office'],
    ARRAY['bac_chair',       'reports.office'],
    ARRAY['school_head',     'reports.office'],
    ARRAY['auditor',         'reports.office'],
    ARRAY['accountant',      'reports.office'],
    -- Division Admin permissions
    ARRAY['division_admin',  'users.manage'],
    ARRAY['division_admin',  'roles.assign'],
    ARRAY['division_admin',  'offices.manage'],
    ARRAY['hope',            'offices.manage'],
    ARRAY['division_admin',  'division.settings'],
    ARRAY['division_admin',  'division.audit_logs'],
    ARRAY['auditor',         'division.audit_logs']
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

SELECT procurements._seed_role_permissions();
DROP FUNCTION procurements._seed_role_permissions();
