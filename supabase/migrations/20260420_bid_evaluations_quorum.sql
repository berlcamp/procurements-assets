-- Phase 8.5 Step 5 — Bid Evaluations audit table + BAC quorum enforcement
--
-- RA 12009 Sec 14 — BAC must have at least 5 members and a majority
-- (typically ≥3) for valid action. Decisions like declaring a bid
-- responsive, post-qualifying the LCB, or recommending award require
-- a quorum of BAC members to participate.
--
-- This migration:
--   * Adds bid_evaluations: one row per (bid, evaluator), capturing each
--     BAC member's individual verdict on each bid. This is the audit
--     trail RA 12009 expects.
--   * Adds min_bac_quorum to procurement_method_ceilings (data-driven).
--   * Extends evaluate_bids() to upsert bid_evaluations rows for the
--     calling user as it applies their verdicts.
--   * Extends award_procurement() to enforce the quorum rule per method.
--
-- Non-destructive.

-- ============================================================
-- 1. Add quorum config to procurement_method_ceilings
-- ============================================================
ALTER TABLE procurements.procurement_method_ceilings
  ADD COLUMN IF NOT EXISTS min_bac_quorum INT;

COMMENT ON COLUMN procurements.procurement_method_ceilings.min_bac_quorum IS
  'Minimum distinct BAC member evaluators required before award. RA 12009 typically: 3 for Competitive Bidding, NULL (waived) for SVP/Shopping.';

-- Seed defaults — verify against latest GPPB Resolution.
UPDATE procurements.procurement_method_ceilings SET min_bac_quorum = 3
 WHERE procurement_mode = 'competitive_bidding';

UPDATE procurements.procurement_method_ceilings SET min_bac_quorum = NULL
 WHERE procurement_mode IN ('svp', 'shopping', 'negotiated', 'direct_contracting',
                             'repeat_order', 'emergency', 'agency_to_agency');

-- ============================================================
-- 2. bid_evaluations table — one row per (bid, evaluator)
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.bid_evaluations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id          UUID NOT NULL REFERENCES procurements.bids(id) ON DELETE CASCADE,
  evaluator_id    UUID NOT NULL REFERENCES auth.users(id),
  is_responsive   BOOLEAN NOT NULL,
  is_eligible     BOOLEAN NOT NULL,
  is_compliant    BOOLEAN NOT NULL,
  technical_pass  BOOLEAN,
  financial_pass  BOOLEAN,
  evaluation_score NUMERIC(5,2),
  remarks         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bid_evaluator UNIQUE (bid_id, evaluator_id)
);

CREATE INDEX idx_bid_evaluations_bid       ON procurements.bid_evaluations(bid_id);
CREATE INDEX idx_bid_evaluations_evaluator ON procurements.bid_evaluations(evaluator_id);

CREATE TRIGGER trg_bid_evaluations_updated_at
  BEFORE UPDATE ON procurements.bid_evaluations
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

ALTER TABLE procurements.bid_evaluations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. RLS — division-scoped via parent procurement
-- ============================================================
CREATE POLICY "division_read_bid_evaluations" ON procurements.bid_evaluations
  FOR SELECT TO authenticated
  USING (
    bid_id IN (
      SELECT b.id FROM procurements.bids b
      JOIN procurements.procurement_activities pa ON pa.id = b.procurement_id
      WHERE pa.division_id = procurements.get_user_division_id()
        AND pa.deleted_at  IS NULL
        AND b.deleted_at   IS NULL
    )
  );

CREATE POLICY "manage_bid_evaluations" ON procurements.bid_evaluations
  FOR ALL TO authenticated
  USING (
    bid_id IN (
      SELECT b.id FROM procurements.bids b
      JOIN procurements.procurement_activities pa ON pa.id = b.procurement_id
      WHERE pa.division_id = procurements.get_user_division_id()
        AND pa.deleted_at  IS NULL
    )
    AND (
      procurements.has_permission('bid.evaluate')
      OR procurements.has_permission('proc.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    bid_id IN (
      SELECT b.id FROM procurements.bids b
      JOIN procurements.procurement_activities pa ON pa.id = b.procurement_id
      WHERE pa.division_id = procurements.get_user_division_id()
    )
  );

-- ============================================================
-- 4. Helper: procurement_evaluator_count(procurement_id) → INT
--    Returns distinct evaluators who have at least one bid_evaluations
--    row on this procurement.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.procurement_evaluator_count(p_procurement_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT COUNT(DISTINCT be.evaluator_id)::INT
    FROM procurements.bid_evaluations be
    JOIN procurements.bids b ON b.id = be.bid_id
   WHERE b.procurement_id = p_procurement_id
     AND b.deleted_at     IS NULL;
$$;

GRANT EXECUTE ON FUNCTION procurements.procurement_evaluator_count(UUID) TO authenticated;

-- ============================================================
-- 5. Helper: procurement_has_bac_quorum(procurement_id) → BOOLEAN
--    Reads min_bac_quorum from the ceiling table; returns TRUE if
--    the rule is waived (NULL) or if at least that many distinct
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.procurement_has_bac_quorum(p_procurement_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_method  TEXT;
  v_min     INT;
  v_actual  INT;
BEGIN
  SELECT procurement_method INTO v_method
    FROM procurements.procurement_activities
   WHERE id = p_procurement_id;

  SELECT min_bac_quorum INTO v_min
    FROM procurements.procurement_method_ceilings
   WHERE procurement_mode = v_method;

  IF v_min IS NULL THEN
    RETURN TRUE;  -- quorum not enforced for this method
  END IF;

  v_actual := procurements.procurement_evaluator_count(p_procurement_id);
  RETURN v_actual >= v_min;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.procurement_has_bac_quorum(UUID) TO authenticated;

-- ============================================================
-- 6. Rewrite evaluate_bids to ALSO upsert bid_evaluations rows
--    for the calling evaluator. The existing aggregate fields
--    (is_responsive, is_eligible, is_compliant, rank) on `bids`
--    are still updated as before so downstream code keeps working.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.evaluate_bids(
  p_procurement_id UUID,
  p_evaluations    JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc      RECORD;
  v_eval      JSONB;
  v_rank      INTEGER := 0;
  v_bid_id    UUID;
  v_resp      BOOLEAN;
  v_elig      BOOLEAN;
  v_comp      BOOLEAN;
  v_score     NUMERIC;
  v_remarks   TEXT;
BEGIN
  IF NOT (procurements.has_permission('bid.evaluate') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to evaluate bids';
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
    RAISE EXCEPTION 'Cannot evaluate bids on a % procurement', v_proc.status;
  END IF;

  -- Apply each evaluation
  FOR v_eval IN SELECT * FROM jsonb_array_elements(p_evaluations)
  LOOP
    v_bid_id := (v_eval->>'bid_id')::UUID;
    v_resp   := (v_eval->>'is_responsive')::BOOLEAN;
    v_elig   := (v_eval->>'is_eligible')::BOOLEAN;
    v_comp   := (v_eval->>'is_compliant')::BOOLEAN;
    v_score  := NULLIF(v_eval->>'evaluation_score', '')::NUMERIC;
    v_remarks := NULLIF(v_eval->>'remarks', '');

    -- Update aggregate flags on the bid (existing behavior)
    UPDATE procurements.bids
       SET is_responsive   = v_resp,
           is_eligible     = v_elig,
           is_compliant    = v_comp,
           evaluation_score = v_score,
           remarks         = COALESCE(v_remarks, remarks),
           status          = CASE
             WHEN v_resp AND v_elig AND v_comp THEN 'evaluated'
             ELSE 'disqualified'
           END,
           disqualification_reason = CASE
             WHEN NOT (v_resp AND v_elig AND v_comp) THEN COALESCE(v_remarks, 'Not responsive/eligible/compliant')
             ELSE disqualification_reason
           END,
           updated_at      = NOW()
     WHERE id = v_bid_id;

    -- NEW: upsert per-evaluator audit row
    INSERT INTO procurements.bid_evaluations (
      bid_id, evaluator_id,
      is_responsive, is_eligible, is_compliant,
      evaluation_score, remarks
    ) VALUES (
      v_bid_id, auth.uid(),
      v_resp, v_elig, v_comp,
      v_score, v_remarks
    )
    ON CONFLICT (bid_id, evaluator_id) DO UPDATE SET
      is_responsive    = EXCLUDED.is_responsive,
      is_eligible      = EXCLUDED.is_eligible,
      is_compliant     = EXCLUDED.is_compliant,
      evaluation_score = EXCLUDED.evaluation_score,
      remarks          = EXCLUDED.remarks,
      updated_at       = NOW();
  END LOOP;

  -- Recompute ranks: lowest amount first among responsive+eligible+compliant
  v_rank := 0;
  FOR v_bid_id IN
    SELECT id FROM procurements.bids
     WHERE procurement_id = p_procurement_id
       AND deleted_at     IS NULL
       AND is_responsive  = TRUE
       AND is_eligible    = TRUE
       AND is_compliant   = TRUE
     ORDER BY bid_amount ASC
  LOOP
    v_rank := v_rank + 1;
    UPDATE procurements.bids SET rank = v_rank WHERE id = v_bid_id;
  END LOOP;

  -- Clear rank on disqualified bids
  UPDATE procurements.bids
     SET rank = NULL
   WHERE procurement_id = p_procurement_id
     AND (NOT is_responsive OR NOT is_eligible OR NOT is_compliant);
END;
$$;

-- ============================================================
-- 7. Rewrite award_procurement to enforce BAC quorum
-- ============================================================
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

  -- Minimum responsive bids check (data-driven from ceilings)
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

  -- NEW: BAC quorum check (only enforced when min_bac_quorum is set)
  v_quorum_ok := procurements.procurement_has_bac_quorum(p_procurement_id);
  IF NOT v_quorum_ok THEN
    RAISE EXCEPTION
      'BAC quorum not met. % distinct BAC evaluators must record their evaluations on this procurement before award.',
      (SELECT min_bac_quorum FROM procurements.procurement_method_ceilings WHERE procurement_mode = v_proc.procurement_method);
  END IF;

  -- Mark the bid as awarded
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

  -- Compute performance security amount snapshot now that contract amount is set
  UPDATE procurements.procurement_activities pa
     SET performance_security_amount = (
       SELECT v_bid.bid_amount * COALESCE(c.performance_security_percentage, 0.05)
         FROM procurements.procurement_method_ceilings c
        WHERE c.procurement_mode = pa.procurement_method
     )
   WHERE pa.id = p_procurement_id
     AND pa.performance_security_required
     AND pa.performance_security_amount IS NULL;

  -- Advance to award_recommended via stage history
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
END;
$$;
