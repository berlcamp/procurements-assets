-- Phase 2: platform.announcements table
CREATE TABLE IF NOT EXISTS platform.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info'
    CHECK (type IN ('info','warning','critical','maintenance')),
  target_divisions UUID[] DEFAULT NULL, -- NULL = all divisions
  is_active BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_announcements_active ON platform.announcements(is_active);
CREATE INDEX idx_announcements_published ON platform.announcements(published_at);

CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON platform.announcements
  FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();
