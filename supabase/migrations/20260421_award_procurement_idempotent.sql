-- Phase 8.5 follow-up — make award_procurement() idempotent on stage
--
-- Bug fix: previously the only way to call award_procurement() was from
-- an earlier stage (post_qualification etc) and it inserted a new
-- procurement_stages row for award_recommended. If the user advanced
-- through the stages manually with the generic Advance button (which
-- only moves the stage label, not the awarded_supplier), they ended up
-- AT award_recommended with awarded_supplier_id NULL — and could not
-- call award_procurement again because it tried to re-insert the stage.
--
-- This rewrite handles both cases:
--   * Called from earlier stage → completes current stage + inserts
--     award_recommended (legacy behavior).
--   * Called while already at award_recommended → only sets the
--     awarded_supplier_id / contract_amount / bid status. No stage
--     mutation.
--   * Allows reselection: if a different bid was previously awarded,
--     it is demoted back to 'evaluated'.

CREATE OR REPLACE FUNCTION procurements.award_procurement(
  p_procurement_id UUID,
  p_bid_id         UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc           RECORD;
  v_bid            RECORD;
  v_responsive_n   INT;
  v_min_bids       INT;
  v_quorum_ok      BOOLEAN;
BEGIN
  IF NOT (procurements.has_permission('award.recommend') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to recommend award';
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
    RAISE EXCEPTION 'Cannot award a % procurement', v_proc.status;
  END IF;

  -- Refuse if already past award_recommended (i.e. HOPE has approved)
  IF v_proc.current_stage IN ('award_approved', 'completed') THEN
    RAISE EXCEPTION 'Award has already been approved (current stage: %)', v_proc.current_stage;
  END IF;

  SELECT * INTO v_bid
    FROM procurements.bids
   WHERE id             = p_bid_id
     AND procurement_id = p_procurement_id
     AND deleted_at     IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bid % does not belong to this procurement', p_bid_id;
  END IF;

  IF NOT (v_bid.is_responsive AND v_bid.is_eligible AND v_bid.is_compliant) THEN
    RAISE EXCEPTION 'Cannot award to a bid that is not responsive, eligible, and compliant';
  END IF;

  SELECT COUNT(*) INTO v_responsive_n
    FROM procurements.bids
   WHERE procurement_id = p_procurement_id
     AND deleted_at     IS NULL
     AND is_responsive  = TRUE
     AND is_eligible    = TRUE
     AND is_compliant   = TRUE;

  SELECT min_quotations INTO v_min_bids
    FROM procurements.procurement_method_ceilings
   WHERE procurement_mode = v_proc.procurement_method;

  IF v_min_bids IS NOT NULL AND v_responsive_n < v_min_bids THEN
    RAISE EXCEPTION 'Cannot award: only % responsive/eligible/compliant bid(s); minimum % required for %',
      v_responsive_n, v_min_bids, v_proc.procurement_method;
  END IF;

  v_quorum_ok := procurements.procurement_has_bac_quorum(p_procurement_id);
  IF NOT v_quorum_ok THEN
    RAISE EXCEPTION
      'BAC quorum not met. % distinct BAC evaluators must record their evaluations on this procurement before award.',
      (SELECT min_bac_quorum FROM procurements.procurement_method_ceilings WHERE procurement_mode = v_proc.procurement_method);
  END IF;

  -- ------------------------------------------------------------
  -- Apply the award
  -- ------------------------------------------------------------

  -- Demote any previously-awarded bid back to evaluated (allows reselection)
  UPDATE procurements.bids
     SET status     = 'evaluated',
         updated_at = NOW()
   WHERE procurement_id = p_procurement_id
     AND status         = 'awarded'
     AND id             <> p_bid_id;

  -- Mark the chosen bid as awarded
  UPDATE procurements.bids
     SET status     = 'awarded',
         updated_at = NOW()
   WHERE id = p_bid_id;

  -- Set procurement award fields
  UPDATE procurements.procurement_activities
     SET awarded_supplier_id = v_bid.supplier_id,
         contract_amount     = v_bid.bid_amount,
         updated_at          = NOW()
   WHERE id = p_procurement_id;

  -- Snapshot performance security amount if required and not yet set
  UPDATE procurements.procurement_activities pa
     SET performance_security_amount = (
       SELECT v_bid.bid_amount * COALESCE(c.performance_security_percentage, 0.05)
         FROM procurements.procurement_method_ceilings c
        WHERE c.procurement_mode = pa.procurement_method
     )
   WHERE pa.id = p_procurement_id
     AND pa.performance_security_required
     AND pa.performance_security_amount IS NULL;

  -- ------------------------------------------------------------
  -- Stage handling — only advance if not already at award_recommended
  -- ------------------------------------------------------------
  IF v_proc.current_stage <> 'award_recommended' THEN
    UPDATE procurements.procurement_stages
       SET status       = 'completed',
           completed_at = NOW(),
           completed_by = auth.uid()
     WHERE procurement_id = p_procurement_id
       AND status         = 'current';

    INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, office_id)
    VALUES (p_procurement_id, 'award_recommended', 'current', NOW(), v_proc.office_id);

    UPDATE procurements.procurement_activities
       SET current_stage = 'award_recommended',
           updated_at    = NOW()
     WHERE id = p_procurement_id;
  END IF;
END;
$$;
