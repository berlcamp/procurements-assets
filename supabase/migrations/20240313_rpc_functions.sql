-- Phase 3: RPC functions for auth/permissions

-- Returns the current user's division_id from user_profiles
CREATE OR REPLACE FUNCTION procurements.get_user_division_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_division_id UUID;
BEGIN
  SELECT division_id INTO v_division_id
  FROM procurements.user_profiles
  WHERE id = auth.uid()
    AND deleted_at IS NULL;

  RETURN v_division_id;
END;
$$;

-- Checks whether the current user's division is active (not suspended)
CREATE OR REPLACE FUNCTION procurements.is_division_active()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_division_id UUID;
  v_status TEXT;
BEGIN
  v_division_id := procurements.get_user_division_id();

  IF v_division_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT subscription_status INTO v_status
  FROM platform.divisions
  WHERE id = v_division_id
    AND deleted_at IS NULL
    AND is_active = true;

  RETURN COALESCE(v_status IN ('active', 'trial'), false);
END;
$$;

-- Generates an auto-incremented sequence number for a given type/year/office
-- Returns formatted string e.g. "PR-2026-0001"
CREATE OR REPLACE FUNCTION procurements.generate_sequence_number(
  p_division_id UUID,
  p_office_id   UUID,
  p_type        TEXT,
  p_year        INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_next   INTEGER;
  v_prefix TEXT;
BEGIN
  -- Lock the row and increment
  UPDATE procurements.sequence_counters
  SET last_value = last_value + 1
  WHERE division_id  = p_division_id
    AND (office_id = p_office_id OR (office_id IS NULL AND p_office_id IS NULL))
    AND counter_type = p_type
    AND fiscal_year  = p_year
  RETURNING last_value, prefix INTO v_next, v_prefix;

  -- If no counter exists, create one starting at 1
  IF NOT FOUND THEN
    v_prefix := upper(p_type);
    INSERT INTO procurements.sequence_counters
      (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
    VALUES
      (p_division_id, p_office_id, p_type, p_year, 1, v_prefix)
    RETURNING last_value, prefix INTO v_next, v_prefix;
  END IF;

  RETURN v_prefix || '-' || p_year || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

-- Returns an array of permission codes for the current user
CREATE OR REPLACE FUNCTION procurements.get_user_permissions()
RETURNS TEXT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_division_id UUID;
  v_permissions TEXT[];
BEGIN
  v_division_id := procurements.get_user_division_id();

  IF v_division_id IS NULL THEN
    -- Check if super admin (platform permissions)
    IF platform.is_super_admin() THEN
      SELECT ARRAY_AGG(p.code)
      INTO v_permissions
      FROM procurements.permissions p
      WHERE p.scope = 'platform';
    END IF;
    RETURN COALESCE(v_permissions, ARRAY[]::TEXT[]);
  END IF;

  SELECT ARRAY_AGG(DISTINCT p.code)
  INTO v_permissions
  FROM procurements.user_roles ur
  JOIN procurements.role_permissions rp ON rp.role_id = ur.role_id
  JOIN procurements.permissions p ON p.id = rp.permission_id
  WHERE ur.user_id    = auth.uid()
    AND ur.division_id = v_division_id
    AND ur.is_active   = true
    AND ur.revoked_at  IS NULL;

  RETURN COALESCE(v_permissions, ARRAY[]::TEXT[]);
END;
$$;

-- Boolean check: does the current user have a specific permission?
CREATE OR REPLACE FUNCTION procurements.has_permission(p_permission_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  RETURN p_permission_code = ANY(procurements.get_user_permissions());
END;
$$;
