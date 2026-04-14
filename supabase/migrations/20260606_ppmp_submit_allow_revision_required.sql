-- =============================================================================
-- Allow re-submission of PPMPs in revision_required status
-- =============================================================================
-- When a PPMP is returned to the end user (status → revision_required) they
-- must be able to re-submit it after making corrections. The original
-- submit_ppmp function only accepted 'draft'; this patch widens that check to
-- also accept 'revision_required'.
-- =============================================================================

CREATE OR REPLACE FUNCTION procurements.submit_ppmp(
  p_ppmp_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp          RECORD;
  v_project_count INTEGER;
  v_version_id    UUID;
  v_alloc_rec     RECORD;
BEGIN
  SELECT *
    INTO v_ppmp
    FROM procurements.ppmps
   WHERE id          = p_ppmp_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  IF v_ppmp.created_by <> auth.uid()
    AND NOT procurements.has_permission('ppmp.submit')
  THEN
    RAISE EXCEPTION 'Insufficient permissions to submit PPMP %', p_ppmp_id;
  END IF;

  -- Allow re-submission after a return (revision_required) in addition to
  -- the normal initial submission from draft.
  IF v_ppmp.status NOT IN ('draft', 'revision_required') THEN
    RAISE EXCEPTION 'Only draft or revision-required PPMPs can be submitted (current status: %)', v_ppmp.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.ppmp_versions
   WHERE ppmp_id        = p_ppmp_id
     AND version_number = v_ppmp.current_version;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'No version found for PPMP % (version %)', p_ppmp_id, v_ppmp.current_version;
  END IF;

  -- At least one project must exist
  SELECT COUNT(*) INTO v_project_count
    FROM procurements.ppmp_projects
   WHERE ppmp_version_id = v_version_id
     AND deleted_at      IS NULL;

  IF v_project_count = 0 THEN
    RAISE EXCEPTION 'Cannot submit PPMP % — it has no procurement projects', p_ppmp_id;
  END IF;

  -- Every project must have at least one lot with at least one item
  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_projects pp
     WHERE pp.ppmp_version_id = v_version_id
       AND pp.deleted_at      IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM procurements.ppmp_lots pl
           JOIN procurements.ppmp_lot_items pli ON pli.ppmp_lot_id = pl.id
          WHERE pl.ppmp_project_id = pp.id
       )
  ) THEN
    RAISE EXCEPTION 'All procurement projects must have at least one lot with items';
  END IF;

  -- Every lot must have estimated_budget > 0
  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
     WHERE pp.ppmp_version_id = v_version_id
       AND pp.deleted_at      IS NULL
       AND pl.estimated_budget <= 0
  ) THEN
    RAISE EXCEPTION 'All lots must have an estimated budget greater than zero';
  END IF;

  -- Budget availability check
  FOR v_alloc_rec IN
    SELECT
      pl.budget_allocation_id,
      SUM(pl.estimated_budget) AS ppmp_total,
      ba.adjusted_amount,
      ba.obligated_amount
    FROM procurements.ppmp_lots pl
    JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
    JOIN procurements.budget_allocations ba ON ba.id = pl.budget_allocation_id
   WHERE pp.ppmp_version_id   = v_version_id
     AND pp.deleted_at        IS NULL
     AND pl.budget_allocation_id IS NOT NULL
   GROUP BY pl.budget_allocation_id, ba.adjusted_amount, ba.obligated_amount
  LOOP
    IF v_alloc_rec.ppmp_total > (v_alloc_rec.adjusted_amount - v_alloc_rec.obligated_amount) THEN
      RAISE EXCEPTION
        'PPMP lots for allocation % exceed available budget (PPMP total: %, available: %)',
        v_alloc_rec.budget_allocation_id,
        v_alloc_rec.ppmp_total,
        (v_alloc_rec.adjusted_amount - v_alloc_rec.obligated_amount);
    END IF;
  END LOOP;

  UPDATE procurements.ppmps
     SET status       = 'submitted',
         submitted_at = NOW(),
         submitted_by = auth.uid(),
         updated_at   = NOW()
   WHERE id = p_ppmp_id;

  UPDATE procurements.ppmp_versions
     SET status = 'submitted'
   WHERE id = v_version_id;
END;
$$;
