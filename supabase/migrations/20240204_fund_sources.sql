-- Phase 2: fund_sources table (shared lookup in procurements schema)
CREATE SCHEMA IF NOT EXISTS procurements;

CREATE TABLE IF NOT EXISTS procurements.fund_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: Standard DepEd fund sources
INSERT INTO procurements.fund_sources (code, name, description) VALUES
  ('GF', 'General Fund', 'National government appropriations for regular operations'),
  ('SEF', 'Special Education Fund', 'Locally sourced fund for education from LGU tax'),
  ('TF', 'Trust Fund', 'Funds held in trust for specific purposes'),
  ('MOOE', 'Maintenance and Other Operating Expenses', 'Non-personal services expenses for operations'),
  ('CO', 'Capital Outlay', 'Expenditures for acquisition of fixed assets'),
  ('PS', 'Personal Services', 'Salaries, wages, and related emoluments'),
  ('RLIP', 'RLIP', 'Retirement and Life Insurance Premium'),
  ('LGSF', 'LGSF', 'Local Government Support Fund')
ON CONFLICT (code) DO NOTHING;
