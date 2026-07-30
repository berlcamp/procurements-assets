-- Add planning_stage / budget_ceiling_id to get_ppmp_version_history()'s
-- return shape. The live definition (supabase/migrations/20240505_ppmp_restructure.sql,
-- the last file in filename order to (re)define this function, and therefore
-- the one that actually won at apply time) still only returns the deprecated,
-- approval-derived indicative_final. The version-history page reads this RPC
-- directly, so it kept rendering the inverted flag even after 20260802/20260803
-- landed planning_stage on ppmp_versions itself.
--
-- indicative_final is kept in the return shape (deprecated, not removed) so
-- any other caller relying on that column keeps working.
--
-- Postgres cannot change a function's return type with CREATE OR REPLACE, so
-- the function must be dropped first.

DROP FUNCTION IF EXISTS procurements.get_ppmp_version_history(UUID);

CREATE OR REPLACE FUNCTION procurements.get_ppmp_version_history(
  p_ppmp_id UUID
)
RETURNS TABLE (
  version_number          INTEGER,
  version_type            TEXT,
  status                  TEXT,
  indicative_final        TEXT,
  planning_stage          TEXT,
  budget_ceiling_id       UUID,
  total_estimated_budget  NUMERIC(15,2),
  amendment_justification TEXT,
  approved_by             UUID,
  approved_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ,
  project_count           BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM procurements.ppmps
     WHERE id          = p_ppmp_id
       AND division_id = procurements.get_user_division_id()
       AND deleted_at  IS NULL
  ) THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  RETURN QUERY
  SELECT
    pv.version_number,
    pv.version_type,
    pv.status,
    pv.indicative_final,
    pv.planning_stage,
    pv.budget_ceiling_id,
    pv.total_estimated_budget,
    pv.amendment_justification,
    pv.approved_by,
    pv.approved_at,
    pv.created_at,
    COUNT(pp.id) AS project_count
  FROM procurements.ppmp_versions pv
  LEFT JOIN procurements.ppmp_projects pp
         ON pp.ppmp_version_id = pv.id
        AND pp.deleted_at      IS NULL
  WHERE pv.ppmp_id = p_ppmp_id
  GROUP BY
    pv.version_number,
    pv.version_type,
    pv.status,
    pv.indicative_final,
    pv.planning_stage,
    pv.budget_ceiling_id,
    pv.total_estimated_budget,
    pv.amendment_justification,
    pv.approved_by,
    pv.approved_at,
    pv.created_at
  ORDER BY pv.version_number DESC;
END;
$$;

-- No explicit GRANT is added here: no migration ever GRANTed EXECUTE on this
-- function to a specific role, nor REVOKEd the default PUBLIC EXECUTE that
-- Postgres assigns to new functions. The DROP + CREATE above re-creates the
-- function fresh, so it retains that same default PUBLIC EXECUTE privilege —
-- identical access as before this migration. No `public.*` RPC wrapper exists
-- for get_ppmp_version_history (checked supabase/migrations/20240403_public_rpc_wrappers.sql
-- and grepped all migrations for the function name), so there is nothing else
-- to update.
