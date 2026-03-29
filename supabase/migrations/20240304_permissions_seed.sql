-- Phase 3: permissions table with full seed data
CREATE TABLE IF NOT EXISTS procurements.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL DEFAULT 'division'
    CHECK (scope IN ('platform', 'division')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Platform-level permissions (Super Admin only)
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('division.create',       'platform', 'Onboard new divisions',                                      'platform'),
  ('division.manage',       'platform', 'Edit and manage divisions',                                   'platform'),
  ('division.suspend',      'platform', 'Suspend or reactivate divisions',                             'platform'),
  ('subscription.manage',   'platform', 'Manage subscription plans and limits',                        'platform'),
  ('platform.settings',     'platform', 'Manage platform-wide settings',                               'platform'),
  ('platform.announcements','platform', 'Create and manage platform announcements',                    'platform'),
  ('platform.audit_logs',   'platform', 'View platform-level audit logs',                              'platform'),
  ('lookup_data.manage',    'platform', 'Manage UACS codes and fund sources',                          'platform'),
  ('platform.analytics',    'platform', 'View platform analytics and reports',                         'platform')
ON CONFLICT (code) DO NOTHING;

-- Division-level permissions

-- Planning
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('ppmp.create',       'planning', 'Create PPMP',                                                     'division'),
  ('ppmp.edit',         'planning', 'Edit draft PPMP',                                                 'division'),
  ('ppmp.submit',       'planning', 'Submit PPMP for review',                                          'division'),
  ('ppmp.review_chief', 'planning', 'Review PPMP as Section Chief or School Head',                     'division'),
  ('ppmp.certify',      'planning', 'Certify PPMP funds availability as Budget Officer',               'division'),
  ('ppmp.approve',      'planning', 'Approve PPMP as HOPE',                                            'division'),
  ('ppmp.view_all',     'planning', 'View all PPMPs in the division',                                  'division'),
  ('app.review_rows',   'planning', 'Review APP rows (HOPE)',                                          'division'),
  ('app.finalize_lots', 'planning', 'Finalize BAC lots in APP',                                        'division'),
  ('app.approve',       'planning', 'Give final APP approval (HOPE)',                                  'division')
ON CONFLICT (code) DO NOTHING;

-- Budget
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('budget.create',      'budget', 'Create budget allocations',                                        'division'),
  ('budget.adjust',      'budget', 'Create budget adjustment requests',                                'division'),
  ('budget.certify',     'budget', 'Certify budget/fund availability',                                 'division'),
  ('budget.approve_adj', 'budget', 'Approve budget adjustments',                                       'division'),
  ('budget.view_all',    'budget', 'View all budget data in the division',                             'division')
ON CONFLICT (code) DO NOTHING;

-- Procurement
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('pr.create',       'procurement', 'Create Purchase Requests',                                       'division'),
  ('pr.approve',      'procurement', 'Approve Purchase Requests',                                      'division'),
  ('proc.manage',     'procurement', 'Manage procurement activities',                                  'division'),
  ('bid.evaluate',    'procurement', 'Evaluate bids (BAC)',                                            'division'),
  ('bid.award',       'procurement', 'Approve bid award',                                              'division'),
  ('po.create',       'procurement', 'Create Purchase Orders',                                         'division'),
  ('po.approve',      'procurement', 'Approve Purchase Orders',                                        'division'),
  ('delivery.inspect','procurement', 'Inspect and accept deliveries (IAC)',                            'division')
ON CONFLICT (code) DO NOTHING;

-- Assets
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('asset.manage',    'assets', 'Manage assets (stock-in/out, registration)',                          'division'),
  ('asset.assign',    'assets', 'Assign assets to custodians',                                         'division'),
  ('asset.view_own',  'assets', 'View own assigned assets',                                            'division'),
  ('asset.dispose',   'assets', 'Process asset disposal',                                              'division'),
  ('inventory.manage','assets', 'Manage inventory stock cards',                                        'division')
ON CONFLICT (code) DO NOTHING;

-- Requests
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('request.create',  'requests', 'Create supply/equipment/service requests',                          'division'),
  ('request.approve', 'requests', 'Approve requests',                                                  'division'),
  ('request.process', 'requests', 'Process and fulfill requests',                                      'division')
ON CONFLICT (code) DO NOTHING;

-- Reports
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('reports.all',    'reports', 'View all division reports',                                           'division'),
  ('reports.office', 'reports', 'View own office reports',                                             'division')
ON CONFLICT (code) DO NOTHING;

-- Division Admin
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('users.manage',       'admin', 'Manage division users',                                             'division'),
  ('roles.assign',       'admin', 'Assign roles to users',                                             'division'),
  ('offices.manage',     'admin', 'Manage offices and schools',                                        'division'),
  ('division.settings',  'admin', 'Manage division settings',                                          'division'),
  ('division.audit_logs','admin', 'View division audit logs',                                          'division')
ON CONFLICT (code) DO NOTHING;
