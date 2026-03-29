-- Phase 3: user_profiles table
CREATE TABLE IF NOT EXISTS procurements.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  division_id UUID NOT NULL REFERENCES platform.divisions(id),
  employee_id TEXT,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  suffix TEXT,
  position TEXT,
  department TEXT,
  office_id UUID REFERENCES procurements.offices(id),
  contact_number TEXT,
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, employee_id)
);

CREATE INDEX idx_user_profiles_division ON procurements.user_profiles(division_id);
CREATE INDEX idx_user_profiles_office ON procurements.user_profiles(office_id);
CREATE INDEX idx_user_profiles_active ON procurements.user_profiles(is_active) WHERE deleted_at IS NULL;
