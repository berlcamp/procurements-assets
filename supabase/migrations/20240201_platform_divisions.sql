-- Phase 2: platform.divisions table
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL,
  address TEXT,
  contact_number TEXT,
  email TEXT,
  logo_url TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (subscription_status IN ('pending','trial','active','suspended','expired')),
  subscription_plan TEXT NOT NULL DEFAULT 'basic',
  trial_ends_at TIMESTAMPTZ,
  subscription_starts_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  max_users INTEGER NOT NULL DEFAULT 50,
  max_schools INTEGER NOT NULL DEFAULT 30,
  onboarded_by UUID REFERENCES auth.users(id),
  onboarded_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_divisions_code ON platform.divisions(code);
CREATE INDEX idx_divisions_status ON platform.divisions(subscription_status);
CREATE INDEX idx_divisions_active ON platform.divisions(is_active) WHERE deleted_at IS NULL;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION platform.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_divisions_updated_at
  BEFORE UPDATE ON platform.divisions
  FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();
