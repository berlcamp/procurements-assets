-- Add BAC Vice Chairperson role with the same permissions as BAC Chairperson

INSERT INTO procurements.roles (name, display_name, description, scope)
VALUES (
  'bac_vice_chair',
  'BAC Vice Chairperson',
  'Assists the BAC Chairperson, presides in their absence, and signs BAC resolutions.',
  'office'
)
ON CONFLICT (name) DO NOTHING;

-- Copy all current permissions from bac_chair to bac_vice_chair
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT
  (SELECT id FROM procurements.roles WHERE name = 'bac_vice_chair'),
  permission_id
FROM procurements.role_permissions
WHERE role_id = (SELECT id FROM procurements.roles WHERE name = 'bac_chair')
ON CONFLICT (role_id, permission_id) DO NOTHING;
