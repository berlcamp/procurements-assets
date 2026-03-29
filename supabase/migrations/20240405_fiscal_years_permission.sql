-- Add missing fiscal_years.manage permission and assign to division_admin
-- The fiscal_years RLS policy references this permission but it was never seeded

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('fiscal_years.manage', 'admin', 'Manage fiscal years', 'division')
ON CONFLICT (code) DO NOTHING;

-- Assign to division_admin role
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r, procurements.permissions p
WHERE r.name = 'division_admin' AND p.code = 'fiscal_years.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
