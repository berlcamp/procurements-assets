-- Phase 3: roles table with seed data
CREATE TABLE IF NOT EXISTS procurements.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  is_system_role BOOLEAN NOT NULL DEFAULT true,
  scope TEXT NOT NULL DEFAULT 'office'
    CHECK (scope IN ('platform', 'division', 'office')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: 16 system roles (15 from EXECUTION_PLAN + section_chief from SYSTEM_PLAN)
INSERT INTO procurements.roles (name, display_name, description, scope) VALUES
  ('super_admin',        'Super Administrator',              'Full platform access. Manages divisions and subscriptions.',                                  'platform'),
  ('division_admin',     'Division Administrator',           'Full admin within their division: users, offices, schools, roles, settings.',                 'division'),
  ('hope',               'Schools Division Superintendent',  'Final approving authority for procurement, APP, budgets. Also known as SDS or HOPE.',         'division'),
  ('division_chief',     'Division Chief',                   'Reviews and recommends for HOPE approval.',                                                   'division'),
  ('auditor',            'Auditor',                          'Read-only access to all data within the division for audit purposes.',                        'division'),
  ('section_chief',      'Section Chief',                    'Reviews PPMPs from End Users in division offices, forwards to Budget Officer.',               'office'),
  ('budget_officer',     'Budget Officer',                   'Budget creation, certification, monitoring, and PPMP fund certification.',                    'office'),
  ('supply_officer',     'Supply Officer',                   'Procurement processing, inventory and asset management.',                                     'office'),
  ('bac_chair',          'BAC Chairperson',                  'Leads BAC proceedings, signs BAC resolutions.',                                               'office'),
  ('bac_member',         'BAC Member',                       'Evaluates bids, participates in BAC proceedings.',                                            'office'),
  ('bac_secretariat',    'BAC Secretariat',                  'Prepares bid documents, manages procurement timeline.',                                       'office'),
  ('iac_member',         'Inspection Committee Member',      'Inspects deliveries, signs inspection and acceptance reports.',                               'office'),
  ('property_custodian', 'Property Custodian',               'Manages assigned assets, reports condition and status.',                                      'office'),
  ('end_user',           'End User',                         'Creates PPMPs, PRs for own rows, requests. In schools the Admin Officer acts as End User.',   'office'),
  ('school_head',        'School Head',                      'Approves school-level PPMPs and requests.',                                                   'office'),
  ('accountant',         'Accountant',                       'Certifies disbursements, financial reports.',                                                 'office')
ON CONFLICT (name) DO NOTHING;
