-- Phase 8.5 Step 3 — Post-Qualification stage
--
-- RA 12009 / GPRA mandates post-qualification of the Lowest Calculated
-- Bid (LCB) before declaring it the Lowest Calculated Responsive Bid (LCRB).
-- For SVP/Shopping the post-qualification is lighter (verify the apparent
-- winner's docs/specs/financial capacity), but the gate must still exist
-- in the audit trail.
--
-- This migration:
--   * Inserts `post_qualification` between evaluation/comparison and
--     award_recommended in both SVP and Shopping flows.
--   * Re-creates advance_procurement_stage carrying forward all earlier
--     enforcement (NGPA publication + posting deadline + lot support).
--
-- Existing in-flight activities are unaffected: those at award_recommended
-- or later are already past the new gate; those at abstract_prepared
-- (SVP) or comparison (Shopping) will be required to traverse the new
-- post_qualification stage on their next advance.

CREATE OR REPLACE FUNCTION procurements.advance_procurement_stage(
  p_procurement_id UUID,
  p_next_stage     TEXT,
  p_notes          TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc          RECORD;
  v_ceiling       RECORD;
  v_valid_stages  TEXT[];
  v_current_idx   INTEGER;
  v_next_idx      INTEGER;
  v_deadline      TIMESTAMPTZ;
BEGIN
  IF NOT (procurements.has_permission('proc.advance') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to advance procurement stage';
  END IF;

  SELECT * INTO v_proc
    FROM procurements.procurement_activities
   WHERE id          = p_procurement_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Procurement activity % not found', p_procurement_id;
  END IF;

  IF v_proc.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot advance stages on a % procurement', v_proc.status;
  END IF;

  SELECT * INTO v_ceiling
    FROM procurements.procurement_method_ceilings
   WHERE procurement_mode = v_proc.procurement_method;

  -- Define valid stage sequences per method (post_qualification inserted)
  CASE v_proc.procurement_method
    WHEN 'svp' THEN
      v_valid_stages := ARRAY[
        'created', 'rfq_preparation', 'rfq_sent', 'quotations_received',
        'evaluation', 'abstract_prepared', 'post_qualification',
        'award_recommended', 'award_approved', 'completed'
      ];
    WHEN 'shopping' THEN
      v_valid_stages := ARRAY[
        'created', 'canvass_preparation', 'canvass_sent', 'canvass_received',
        'comparison', 'post_qualification',
        'award_recommended', 'award_approved', 'completed'
      ];
    ELSE
      RAISE EXCEPTION 'Stage advancement not yet implemented for method: %', v_proc.procurement_method;
  END CASE;

  SELECT array_position(v_valid_stages, v_proc.current_stage) INTO v_current_idx;
  SELECT array_position(v_valid_stages, p_next_stage) INTO v_next_idx;

  IF v_current_idx IS NULL THEN
    RAISE EXCEPTION 'Current stage % is not in valid stage list for method %',
      v_proc.current_stage, v_proc.procurement_method;
  END IF;

  IF v_next_idx IS NULL THEN
    RAISE EXCEPTION 'Target stage % is not valid for method %',
      p_next_stage, v_proc.procurement_method;
  END IF;

  IF v_next_idx <> v_current_idx + 1 THEN
    RAISE EXCEPTION 'Cannot skip stages. Current: %, Next expected: %, Got: %',
      v_proc.current_stage,
      v_valid_stages[v_current_idx + 1],
      p_next_stage;
  END IF;

  -- ------------------------------------------------------------
  -- NGPA enforcement (preserved from 20260415)
  -- ------------------------------------------------------------

  -- (a) Entering rfq_sent / canvass_sent: stamp posting + require PhilGEPS ref
  IF p_next_stage IN ('rfq_sent', 'canvass_sent') THEN
    IF v_ceiling.requires_philgeps_publication
       AND COALESCE(NULLIF(TRIM(v_proc.philgeps_reference), ''), NULL) IS NULL
    THEN
      RAISE EXCEPTION 'PhilGEPS reference is required before advancing to %. Set procurement_activities.philgeps_reference first.',
        p_next_stage;
    END IF;

    v_deadline := NOW() + (COALESCE(v_proc.posting_required_days, v_ceiling.min_posting_days, 0) || ' days')::INTERVAL;

    UPDATE procurements.procurement_activities
       SET posting_date          = COALESCE(posting_date, NOW()),
           submission_deadline   = COALESCE(submission_deadline, v_deadline),
           philgeps_published_at = CASE
             WHEN v_ceiling.requires_philgeps_publication
                  AND philgeps_published_at IS NULL THEN NOW()
             ELSE philgeps_published_at
           END
     WHERE id = p_procurement_id;
  END IF;

  -- (b) Entering quotations_received / canvass_received: enforce deadline
  IF p_next_stage IN ('quotations_received', 'canvass_received') THEN
    IF v_proc.submission_deadline IS NOT NULL
       AND NOW() < v_proc.submission_deadline
       AND COALESCE(LENGTH(TRIM(p_notes)), 0) < 10
    THEN
      RAISE EXCEPTION 'Submission deadline (%) has not yet passed. Provide a justification of at least 10 characters in notes to proceed early.',
        v_proc.submission_deadline;
    END IF;
  END IF;

  -- (c) NEW: entering post_qualification — require at least one bid that
  --     is responsive AND eligible AND compliant (otherwise nothing to verify)
  IF p_next_stage = 'post_qualification' THEN
    IF NOT EXISTS (
      SELECT 1 FROM procurements.bids
       WHERE procurement_id = p_procurement_id
         AND deleted_at     IS NULL
         AND is_responsive  = TRUE
         AND is_eligible    = TRUE
         AND is_compliant   = TRUE
    ) THEN
      RAISE EXCEPTION 'Cannot enter post-qualification: no bid has been marked responsive, eligible, and compliant. Run evaluation first.';
    END IF;
  END IF;

  -- (d) NEW: leaving post_qualification → award_recommended requires a notes
  --     entry documenting the post-qualification verdict (≥10 chars).
  IF v_proc.current_stage = 'post_qualification' AND p_next_stage = 'award_recommended' THEN
    IF COALESCE(LENGTH(TRIM(p_notes)), 0) < 10 THEN
      RAISE EXCEPTION 'Post-qualification verdict requires a notes entry of at least 10 characters (e.g. "LCB passed post-qualification on docs/specs/NFCC").';
    END IF;
  END IF;

  -- ------------------------------------------------------------
  -- Apply the stage transition
  -- ------------------------------------------------------------

  UPDATE procurements.procurement_stages
     SET status       = 'completed',
         completed_at = NOW(),
         completed_by = auth.uid(),
         notes        = COALESCE(p_notes, notes)
   WHERE procurement_id = p_procurement_id
     AND status          = 'current';

  INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, office_id)
  VALUES (p_procurement_id, p_next_stage, 'current', NOW(), v_proc.office_id);

  UPDATE procurements.procurement_activities
     SET current_stage = p_next_stage,
         updated_at    = NOW()
   WHERE id = p_procurement_id;

  IF p_next_stage = 'completed' THEN
    UPDATE procurements.procurement_activities
       SET status     = 'completed',
           updated_at = NOW()
     WHERE id = p_procurement_id;

    UPDATE procurements.purchase_requests
       SET status     = 'completed',
           updated_at = NOW()
     WHERE id = v_proc.purchase_request_id;
  END IF;
END;
$$;
