-- Division join requests: approval workflow for uninvited users joining existing divisions

CREATE TABLE IF NOT EXISTS procurements.division_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  division_id UUID NOT NULL REFERENCES platform.divisions(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  middle_name TEXT,
  suffix TEXT,
  position TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate pending requests per user/division
CREATE UNIQUE INDEX idx_join_requests_unique_pending
  ON procurements.division_join_requests(user_id, division_id) WHERE status = 'pending';

CREATE INDEX idx_join_requests_user ON procurements.division_join_requests(user_id);
CREATE INDEX idx_join_requests_division_status ON procurements.division_join_requests(division_id, status);
CREATE INDEX idx_join_requests_pending ON procurements.division_join_requests(division_id) WHERE status = 'pending';

-- Triggers
CREATE TRIGGER trg_join_requests_updated_at
  BEFORE UPDATE ON procurements.division_join_requests
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_join_requests_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.division_join_requests
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- RLS
ALTER TABLE procurements.division_join_requests ENABLE ROW LEVEL SECURITY;

-- Users can read their own join requests
CREATE POLICY "own_join_requests_select"
  ON procurements.division_join_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Division admins can read requests for their division
CREATE POLICY "division_admin_read_join_requests"
  ON procurements.division_join_requests
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('users.manage')
  );

-- Division admins can update (approve/reject) requests for their division
CREATE POLICY "division_admin_update_join_requests"
  ON procurements.division_join_requests
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('users.manage')
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('users.manage')
  );

-- Super admins can manage all join requests
CREATE POLICY "super_admin_manage_join_requests"
  ON procurements.division_join_requests
  FOR ALL TO authenticated
  USING (platform.is_super_admin())
  WITH CHECK (platform.is_super_admin());
