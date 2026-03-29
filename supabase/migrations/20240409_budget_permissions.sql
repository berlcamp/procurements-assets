-- Phase 4: Budget permissions
-- Seed new permission rows for budget module.

INSERT INTO procurements.permissions (code, module, description, scope)
VALUES
  ('budget_allocations.create',  'budget', 'Create budget allocations',          'division'),
  ('budget_allocations.update',  'budget', 'Update budget allocations',          'division'),
  ('budget_allocations.delete',  'budget', 'Soft-delete budget allocations',     'division'),
  ('budget_adjustments.create',  'budget', 'Create budget adjustment requests',  'division'),
  ('budget_adjustments.update',  'budget', 'Update own budget adjustments',      'division'),
  ('budget_adjustments.approve', 'budget', 'Approve/reject budget adjustments',  'division')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------
-- Assign permissions to existing roles
-- Budget Officer: create + update allocations, create + update adjustments
-- Division Chief: approve adjustments only (reviews and recommends)
-- Division Admin: full access
-- HOPE (SDS): create + update allocations, create + update + approve adjustments
-- Auditor: read-only (no explicit permission needed — reads via RLS SELECT policy)
-- ---------------------------------------------------------------

-- Budget Officer role assignments
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'budget_officer'
  AND p.code IN (
    'budget_allocations.create',
    'budget_allocations.update',
    'budget_adjustments.create',
    'budget_adjustments.update'
  )
ON CONFLICT DO NOTHING;

-- Division Chief role assignments (approve only — reviews and recommends, does not create/update)
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'division_chief'
  AND p.code IN (
    'budget_adjustments.approve'
  )
ON CONFLICT DO NOTHING;

-- Division Admin role assignments (full budget access)
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'division_admin'
  AND p.code IN (
    'budget_allocations.create',
    'budget_allocations.update',
    'budget_allocations.delete',
    'budget_adjustments.create',
    'budget_adjustments.update',
    'budget_adjustments.approve'
  )
ON CONFLICT DO NOTHING;

-- HOPE (SDS) role assignments — approve adjustments
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'hope'
  AND p.code IN (
    'budget_allocations.create',
    'budget_allocations.update',
    'budget_adjustments.create',
    'budget_adjustments.update',
    'budget_adjustments.approve'
  )
ON CONFLICT DO NOTHING;
