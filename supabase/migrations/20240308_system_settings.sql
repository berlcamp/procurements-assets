-- Phase 3: system_settings table
CREATE TABLE IF NOT EXISTS procurements.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES platform.divisions(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, key)
);

CREATE INDEX idx_system_settings_division ON procurements.system_settings(division_id);
CREATE INDEX idx_system_settings_category ON procurements.system_settings(category);
