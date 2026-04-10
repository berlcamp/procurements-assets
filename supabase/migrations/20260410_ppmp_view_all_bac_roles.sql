-- Grant ppmp.view_all to BAC roles.
-- BAC Chair and Secretariat consolidate approved PPMPs into the APP,
-- so they need division-wide PPMP visibility.
-- BAC Member is included for consistency with their evaluation responsibilities.

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('bac_chair', 'bac_member', 'bac_secretariat')
  AND p.code = 'ppmp.view_all'
ON CONFLICT (role_id, permission_id) DO NOTHING;
