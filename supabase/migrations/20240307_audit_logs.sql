-- Phase 3: audit.audit_logs table (division-level audit trail)
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID REFERENCES platform.divisions(id),
  table_name TEXT NOT NULL,
  record_id UUID,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_fields TEXT[],
  user_id UUID REFERENCES auth.users(id),
  user_ip TEXT,
  user_agent TEXT,
  office_id UUID,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_division ON audit.audit_logs(division_id);
CREATE INDEX idx_audit_logs_table ON audit.audit_logs(table_name);
CREATE INDEX idx_audit_logs_record ON audit.audit_logs(record_id);
CREATE INDEX idx_audit_logs_user ON audit.audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit.audit_logs(created_at DESC);
