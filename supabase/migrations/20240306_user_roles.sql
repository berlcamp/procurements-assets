-- Phase 3: user_roles table
CREATE TABLE IF NOT EXISTS procurements.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES procurements.roles(id) ON DELETE RESTRICT,
  division_id UUID NOT NULL REFERENCES platform.divisions(id),
  office_id UUID REFERENCES procurements.offices(id),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (user_id, role_id, division_id, office_id)
);

CREATE INDEX idx_user_roles_user ON procurements.user_roles(user_id);
CREATE INDEX idx_user_roles_division ON procurements.user_roles(division_id);
CREATE INDEX idx_user_roles_role ON procurements.user_roles(role_id);
CREATE INDEX idx_user_roles_active ON procurements.user_roles(is_active) WHERE revoked_at IS NULL;
