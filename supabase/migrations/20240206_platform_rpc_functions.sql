-- Phase 2: RPC functions for Super Admin operations

-- Check if current user is Super Admin
CREATE OR REPLACE FUNCTION platform.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, auth, public
AS $$
DECLARE
  v_is_super_admin BOOLEAN;
BEGIN
  SELECT COALESCE(raw_user_meta_data->>'is_super_admin', 'false')::BOOLEAN
  INTO v_is_super_admin
  FROM auth.users
  WHERE id = auth.uid();

  RETURN COALESCE(v_is_super_admin, false);
END;
$$;

-- Onboard a new division
CREATE OR REPLACE FUNCTION platform.onboard_division(
  p_name TEXT,
  p_code TEXT,
  p_region TEXT,
  p_address TEXT DEFAULT NULL,
  p_contact_number TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_subscription_plan TEXT DEFAULT 'basic',
  p_max_users INTEGER DEFAULT 50,
  p_max_schools INTEGER DEFAULT 30
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, auth, public
AS $$
DECLARE
  v_division_id UUID;
  v_user_id UUID;
BEGIN
  -- Verify caller is Super Admin
  IF NOT platform.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super Admin access required';
  END IF;

  v_user_id := auth.uid();

  -- Create the division
  INSERT INTO platform.divisions (
    name, code, region, address, contact_number, email,
    subscription_plan, max_users, max_schools,
    subscription_status, onboarded_by, onboarded_at
  )
  VALUES (
    p_name, p_code, p_region, p_address, p_contact_number, p_email,
    p_subscription_plan, p_max_users, p_max_schools,
    'active', v_user_id, NOW()
  )
  RETURNING id INTO v_division_id;

  -- Log the action
  INSERT INTO platform.platform_audit_logs (action, target_division_id, details, performed_by)
  VALUES (
    'division_onboarded',
    v_division_id,
    jsonb_build_object('name', p_name, 'code', p_code, 'region', p_region),
    v_user_id
  );

  RETURN v_division_id;
END;
$$;

-- Suspend a division
CREATE OR REPLACE FUNCTION platform.suspend_division(
  p_division_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, auth, public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NOT platform.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super Admin access required';
  END IF;

  v_user_id := auth.uid();

  UPDATE platform.divisions
  SET subscription_status = 'suspended', updated_at = NOW()
  WHERE id = p_division_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Division not found';
  END IF;

  INSERT INTO platform.platform_audit_logs (action, target_division_id, details, performed_by)
  VALUES (
    'division_suspended',
    p_division_id,
    jsonb_build_object('reason', p_reason),
    v_user_id
  );
END;
$$;

-- Reactivate a division
CREATE OR REPLACE FUNCTION platform.reactivate_division(
  p_division_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = platform, auth, public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NOT platform.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super Admin access required';
  END IF;

  v_user_id := auth.uid();

  UPDATE platform.divisions
  SET subscription_status = 'active', updated_at = NOW()
  WHERE id = p_division_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Division not found';
  END IF;

  INSERT INTO platform.platform_audit_logs (action, target_division_id, details, performed_by)
  VALUES (
    'division_reactivated',
    p_division_id,
    jsonb_build_object(),
    v_user_id
  );
END;
$$;
