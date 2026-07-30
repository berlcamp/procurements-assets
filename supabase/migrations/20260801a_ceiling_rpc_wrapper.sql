-- Thin public wrapper so supabase.rpc("fiscal_year_planning_stage", ...) resolves
-- without a .schema("procurements") call, mirroring the get_user_division_id
-- wrapper in 20240403_public_rpc_wrappers.sql (PostgREST resolves
-- /rest/v1/rpc/<fn> to public.<fn> unless Content-Profile names another schema).

CREATE OR REPLACE FUNCTION public.fiscal_year_planning_stage(p_fiscal_year_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT procurements.fiscal_year_planning_stage(p_fiscal_year_id);
$$;

GRANT EXECUTE ON FUNCTION public.fiscal_year_planning_stage(UUID) TO authenticated;
