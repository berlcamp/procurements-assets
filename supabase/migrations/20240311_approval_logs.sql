-- Phase 3: approval_logs table
CREATE TABLE IF NOT EXISTS procurements.approval_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_type TEXT NOT NULL,
  reference_id UUID NOT NULL,
  step_name TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'returned', 'forwarded', 'noted')),
  acted_by UUID NOT NULL REFERENCES auth.users(id),
  acted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  remarks TEXT,
  office_id UUID REFERENCES procurements.offices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approval_logs_ref ON procurements.approval_logs(reference_type, reference_id);
CREATE INDEX idx_approval_logs_actor ON procurements.approval_logs(acted_by);
CREATE INDEX idx_approval_logs_created ON procurements.approval_logs(created_at DESC);
