-- Phase 2: platform.platform_audit_logs table
CREATE TABLE IF NOT EXISTS platform.platform_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  target_division_id UUID REFERENCES platform.divisions(id),
  details JSONB,
  performed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_audit_division ON platform.platform_audit_logs(target_division_id);
CREATE INDEX idx_platform_audit_action ON platform.platform_audit_logs(action);
CREATE INDEX idx_platform_audit_created ON platform.platform_audit_logs(created_at DESC);
CREATE INDEX idx_platform_audit_by ON platform.platform_audit_logs(performed_by);
