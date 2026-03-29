-- PostgREST resolves /rest/v1/rpc/<fn> to public.<fn> unless Content-Profile names another schema.
-- Thin public wrappers so default REST and tools that omit schema headers work.

CREATE OR REPLACE FUNCTION public.get_user_division_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT procurements.get_user_division_id();
$$;
