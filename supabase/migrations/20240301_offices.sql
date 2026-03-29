-- Phase 3: offices table
CREATE TABLE IF NOT EXISTS procurements.offices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES platform.divisions(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  office_type TEXT NOT NULL DEFAULT 'section'
    CHECK (office_type IN ('division_office', 'school', 'section')),
  parent_office_id UUID REFERENCES procurements.offices(id),
  address TEXT,
  contact_number TEXT,
  email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE (division_id, code)
);

CREATE INDEX idx_offices_division ON procurements.offices(division_id);
CREATE INDEX idx_offices_parent ON procurements.offices(parent_office_id);
CREATE INDEX idx_offices_type ON procurements.offices(office_type);
CREATE INDEX idx_offices_active ON procurements.offices(is_active) WHERE deleted_at IS NULL;
