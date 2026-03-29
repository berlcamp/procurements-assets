-- Phase 3: notifications table
CREATE TABLE IF NOT EXISTS procurements.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info'
    CHECK (type IN ('info', 'success', 'warning', 'error', 'approval')),
  reference_type TEXT,
  reference_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  office_id UUID REFERENCES procurements.offices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON procurements.notifications(user_id);
CREATE INDEX idx_notifications_unread ON procurements.notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_ref ON procurements.notifications(reference_type, reference_id);
