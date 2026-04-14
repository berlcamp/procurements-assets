-- Fuel Request & Inventory Module — Permissions, Role, and Role-Permission Seed

-- ============================================================
-- 1. New fuel permissions
-- ============================================================
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('fuel.request',          'fuel', 'Create fuel requests (trip tickets)',        'division'),
  ('fuel.approve',          'fuel', 'Approve or reject fuel requests',           'division'),
  ('fuel.manage_inventory', 'fuel', 'Manage fuel stock (stock-in, adjustments)', 'division'),
  ('fuel.view_reports',     'fuel', 'View fuel consumption and stock reports',   'division')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. New fuel_manager role
-- ============================================================
INSERT INTO procurements.roles (name, display_name, description, scope) VALUES
  ('fuel_manager', 'Fuel Manager', 'Approves fuel requests and manages fuel inventory.', 'office')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 3. Role-permission mappings for fuel module
-- ============================================================
CREATE OR REPLACE FUNCTION procurements._seed_fuel_role_permissions()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_role_id UUID;
  v_perm_id UUID;

  v_assignments TEXT[][] := ARRAY[
    -- fuel_manager gets approve, manage, and reports
    ARRAY['fuel_manager',    'fuel.approve'],
    ARRAY['fuel_manager',    'fuel.manage_inventory'],
    ARRAY['fuel_manager',    'fuel.view_reports'],

    -- end_user can create fuel requests
    ARRAY['end_user',        'fuel.request'],

    -- school_head can request and approve
    ARRAY['school_head',     'fuel.request'],
    ARRAY['school_head',     'fuel.approve'],

    -- supply_officer manages inventory and views reports
    ARRAY['supply_officer',  'fuel.manage_inventory'],
    ARRAY['supply_officer',  'fuel.view_reports'],

    -- division_admin gets all fuel permissions
    ARRAY['division_admin',  'fuel.request'],
    ARRAY['division_admin',  'fuel.approve'],
    ARRAY['division_admin',  'fuel.manage_inventory'],
    ARRAY['division_admin',  'fuel.view_reports'],

    -- division_chief can approve and view reports
    ARRAY['division_chief',  'fuel.approve'],
    ARRAY['division_chief',  'fuel.view_reports'],

    -- auditor gets read-only report access
    ARRAY['auditor',         'fuel.view_reports']
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

SELECT procurements._seed_fuel_role_permissions();
DROP FUNCTION procurements._seed_fuel_role_permissions();
