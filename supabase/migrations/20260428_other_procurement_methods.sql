-- =============================================================================
-- Phase 10: Other Procurement Methods
--
-- Extends the procurement engine to support the 5 remaining RA 12009
-- procurement methods:
--
--   * Direct Contracting  (6 stages)
--   * Repeat Order         (6 stages)
--   * Emergency            (6 stages, reversed purchase-first flow)
--   * Negotiated           (6 stages, requires 2 prior failed biddings)
--   * Agency-to-Agency     (4 stages, no BAC required)
--
-- Also adds:
--   * set_procurement_supplier() for non-competitive supplier assignment
--   * Method-specific metadata RPCs
--   * Failed procurement routing helpers
--
-- Non-destructive. All existing SVP/Shopping/Competitive Bidding preserved.
-- =============================================================================

-- ============================================================
-- 1. New columns on procurement_activities for method-specific metadata
-- ============================================================

-- Direct Contracting
ALTER TABLE procurements.procurement_activities
  ADD COLUMN IF NOT EXISTS justification_type        TEXT,
  ADD COLUMN IF NOT EXISTS justification_text         TEXT,
  ADD COLUMN IF NOT EXISTS price_reasonableness_note  TEXT;

-- Repeat Order
ALTER TABLE procurements.procurement_activities
  ADD COLUMN IF NOT EXISTS reference_procurement_id   UUID REFERENCES procurements.procurement_activities(id),
  ADD COLUMN IF NOT EXISTS original_contract_date     DATE,
  ADD COLUMN IF NOT EXISTS price_increase_percentage  NUMERIC(5,2);

-- Emergency
ALTER TABLE procurements.procurement_activities
  ADD COLUMN IF NOT EXISTS emergency_type             TEXT,
  ADD COLUMN IF NOT EXISTS emergency_justification    TEXT,
  ADD COLUMN IF NOT EXISTS emergency_purchase_date    DATE,
  ADD COLUMN IF NOT EXISTS emergency_review_deadline  DATE;

-- Negotiated
ALTER TABLE procurements.procurement_activities
  ADD COLUMN IF NOT EXISTS negotiation_records_note   TEXT;

-- Agency-to-Agency
ALTER TABLE procurements.procurement_activities
  ADD COLUMN IF NOT EXISTS partner_agency_name        TEXT,
  ADD COLUMN IF NOT EXISTS moa_reference              TEXT,
  ADD COLUMN IF NOT EXISTS moa_date                   DATE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_proc_act_ref_procurement
  ON procurements.procurement_activities(reference_procurement_id)
  WHERE reference_procurement_id IS NOT NULL;

-- ============================================================
-- 2. Extend create_procurement_activity() for all 8 methods
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.create_procurement_activity(
  p_pr_id                    UUID,
  p_method                   TEXT,
  p_reference_procurement_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id          UUID := auth.uid();
  v_pr               RECORD;
  v_proc_id          UUID;
  v_proc_number      TEXT;
  v_first_stage      TEXT;
  v_failed_count     INT;
  v_ref_proc         RECORD;
BEGIN
  IF NOT (procurements.has_permission('proc.create') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to create procurement activities';
  END IF;

  IF p_method NOT IN (
    'svp', 'shopping', 'competitive_bidding',
    'direct_contracting', 'repeat_order', 'emergency',
    'negotiated', 'agency_to_agency'
  ) THEN
    RAISE EXCEPTION 'Invalid procurement method: %', p_method;
  END IF;

  SELECT * INTO v_pr
    FROM procurements.purchase_requests
   WHERE id          = p_pr_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Request % not found', p_pr_id;
  END IF;

  IF v_pr.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved PRs can start procurement (current status: %)', v_pr.status;
  END IF;

  IF v_pr.procurement_id IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase Request % already has an active procurement activity', p_pr_id;
  END IF;

  -- Method-specific pre-creation validation
  IF p_method = 'negotiated' THEN
    SELECT COUNT(*) INTO v_failed_count
      FROM procurements.procurement_activities
     WHERE purchase_request_id = p_pr_id
       AND status = 'failed'
       AND deleted_at IS NULL;
    IF v_failed_count < 2 THEN
      RAISE EXCEPTION 'Negotiated Procurement requires at least 2 failed biddings for this PR (found: %)', v_failed_count;
    END IF;
  END IF;

  IF p_method = 'repeat_order' THEN
    IF p_reference_procurement_id IS NULL THEN
      RAISE EXCEPTION 'Repeat Order requires a reference to the original procurement activity';
    END IF;
    SELECT * INTO v_ref_proc
      FROM procurements.procurement_activities
     WHERE id = p_reference_procurement_id
       AND division_id = procurements.get_user_division_id()
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Referenced procurement activity % not found', p_reference_procurement_id;
    END IF;
    IF v_ref_proc.status <> 'completed' THEN
      RAISE EXCEPTION 'Referenced procurement must be completed (current: %)', v_ref_proc.status;
    END IF;
  END IF;

  v_proc_number := procurements.generate_procurement_number(
    v_pr.office_id, v_pr.fiscal_year_id, v_pr.division_id
  );

  CASE p_method
    WHEN 'svp'                 THEN v_first_stage := 'rfq_preparation';
    WHEN 'shopping'            THEN v_first_stage := 'canvass_preparation';
    WHEN 'competitive_bidding' THEN v_first_stage := 'bid_document_preparation';
    WHEN 'direct_contracting'  THEN v_first_stage := 'justification_prepared';
    WHEN 'repeat_order'        THEN v_first_stage := 'reference_verification';
    WHEN 'emergency'           THEN v_first_stage := 'emergency_purchase';
    WHEN 'negotiated'          THEN v_first_stage := 'eligibility_verification';
    WHEN 'agency_to_agency'    THEN v_first_stage := 'agency_identification';
  END CASE;

  INSERT INTO procurements.procurement_activities (
    division_id, procurement_number, office_id, fiscal_year_id,
    purchase_request_id, procurement_method, abc_amount,
    current_stage, status, created_by,
    reference_procurement_id
  ) VALUES (
    v_pr.division_id, v_proc_number, v_pr.office_id, v_pr.fiscal_year_id,
    p_pr_id, p_method, v_pr.total_estimated_cost,
    v_first_stage, 'active', v_user_id,
    p_reference_procurement_id
  )
  RETURNING id INTO v_proc_id;

  INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, completed_at, completed_by, office_id)
  VALUES (v_proc_id, 'created', 'completed', NOW(), NOW(), v_user_id, v_pr.office_id);

  INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, office_id)
  VALUES (v_proc_id, v_first_stage, 'current', NOW(), v_pr.office_id);

  UPDATE procurements.purchase_requests
     SET procurement_id = v_proc_id,
         status         = 'in_procurement',
         updated_at     = NOW()
   WHERE id = p_pr_id;

  UPDATE procurements.obligation_requests
     SET procurement_id = v_proc_id,
         updated_at     = NOW()
   WHERE purchase_request_id = p_pr_id
     AND deleted_at IS NULL;

  RETURN v_proc_id;
END;
$$;

-- ============================================================
-- 3. Extend advance_procurement_stage() with 5 new methods
-- ============================================================
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
  v_posting_days  INTEGER;
  v_bid_count     INTEGER;
  v_failed_count  INTEGER;
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

  -- Define valid stage sequences per method
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
    WHEN 'competitive_bidding' THEN
      v_valid_stages := ARRAY[
        'created', 'bid_document_preparation', 'pre_procurement_conference',
        'itb_published', 'pre_bid_conference', 'bid_submission',
        'bid_opening', 'preliminary_examination',
        'technical_evaluation', 'financial_evaluation',
        'post_qualification', 'bac_resolution',
        'award_recommended', 'award_approved',
        'noa_issued', 'contract_signing', 'ntp_issued', 'completed'
      ];
    WHEN 'direct_contracting' THEN
      v_valid_stages := ARRAY[
        'created', 'justification_prepared', 'bac_recommendation',
        'hope_approval', 'contract_signing', 'completed'
      ];
    WHEN 'repeat_order' THEN
      v_valid_stages := ARRAY[
        'created', 'reference_verification', 'price_verification',
        'bac_confirmation', 'po_issued', 'completed'
      ];
    WHEN 'emergency' THEN
      v_valid_stages := ARRAY[
        'created', 'emergency_purchase', 'purchase_documentation',
        'bac_post_review', 'hope_confirmation', 'completed'
      ];
    WHEN 'negotiated' THEN
      v_valid_stages := ARRAY[
        'created', 'eligibility_verification', 'bac_negotiation',
        'hope_approval', 'contract_signing', 'completed'
      ];
    WHEN 'agency_to_agency' THEN
      v_valid_stages := ARRAY[
        'created', 'agency_identification', 'moa_execution', 'completed'
      ];
    ELSE
      RAISE EXCEPTION 'Stage advancement not implemented for method: %', v_proc.procurement_method;
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

  -- ----------------------------------------------------------------
  -- Pre-bid conference skip for competitive bidding (ABC <= 1M)
  -- ----------------------------------------------------------------
  IF v_proc.procurement_method = 'competitive_bidding'
     AND v_proc.current_stage = 'itb_published'
     AND p_next_stage = 'bid_submission'
     AND v_proc.abc_amount <= 1000000
  THEN
    UPDATE procurements.procurement_stages
       SET status       = 'completed',
           completed_at = NOW(),
           completed_by = auth.uid(),
           notes        = COALESCE(p_notes, 'Pre-bid conference waived per RA 12009 (ABC ≤ ₱1M for goods)')
     WHERE procurement_id = p_procurement_id
       AND status         = 'current';

    INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, completed_at, completed_by, notes, office_id)
    VALUES (p_procurement_id, 'pre_bid_conference', 'completed', NOW(), NOW(), auth.uid(),
            'Pre-bid conference waived per RA 12009 (ABC ≤ ₱1M for goods)', v_proc.office_id);

    INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, office_id)
    VALUES (p_procurement_id, 'bid_submission', 'current', NOW(), v_proc.office_id);

    UPDATE procurements.procurement_activities
       SET current_stage = 'bid_submission',
           updated_at    = NOW()
     WHERE id = p_procurement_id;

    RETURN;
  END IF;

  IF v_next_idx <> v_current_idx + 1 THEN
    RAISE EXCEPTION 'Cannot skip stages. Current: %, Next expected: %, Got: %',
      v_proc.current_stage,
      v_valid_stages[v_current_idx + 1],
      p_next_stage;
  END IF;

  -- ================================================================
  -- VALIDATION GATES (original SVP / Shopping / Competitive Bidding)
  -- ================================================================

  -- (a) Entering rfq_sent / canvass_sent / itb_published: stamp posting + require PhilGEPS ref
  IF p_next_stage IN ('rfq_sent', 'canvass_sent', 'itb_published') THEN
    IF v_ceiling.requires_philgeps_publication
       AND COALESCE(NULLIF(TRIM(v_proc.philgeps_reference), ''), NULL) IS NULL
    THEN
      RAISE EXCEPTION 'PhilGEPS reference is required before advancing to %. Set procurement_activities.philgeps_reference first.',
        p_next_stage;
    END IF;

    v_posting_days := COALESCE(v_proc.posting_required_days, v_ceiling.min_posting_days, 0);
    IF v_proc.procurement_method = 'competitive_bidding' AND v_proc.abc_amount > 50000000 THEN
      v_posting_days := GREATEST(v_posting_days, 21);
    END IF;

    v_deadline := NOW() + (v_posting_days || ' days')::INTERVAL;

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

  -- (b) Entering quotations_received / canvass_received / bid_submission: enforce deadline
  IF p_next_stage IN ('quotations_received', 'canvass_received', 'bid_submission') THEN
    IF v_proc.submission_deadline IS NOT NULL
       AND NOW() < v_proc.submission_deadline
       AND COALESCE(LENGTH(TRIM(p_notes)), 0) < 10
    THEN
      RAISE EXCEPTION 'Submission deadline (%) has not yet passed. Provide a justification of at least 10 characters in notes to proceed early.',
        v_proc.submission_deadline;
    END IF;
  END IF;

  -- (c) Entering bid_opening: require at least 1 bid exists
  IF p_next_stage = 'bid_opening' THEN
    SELECT COUNT(*) INTO v_bid_count
      FROM procurements.bids
     WHERE procurement_id = p_procurement_id
       AND deleted_at     IS NULL;

    IF v_bid_count = 0 THEN
      RAISE EXCEPTION 'Cannot open bids: no bids have been recorded yet.';
    END IF;
  END IF;

  -- (d) Entering preliminary_examination: require minimum bids
  IF p_next_stage = 'preliminary_examination' THEN
    SELECT COUNT(*) INTO v_bid_count
      FROM procurements.bids
     WHERE procurement_id = p_procurement_id
       AND deleted_at     IS NULL;

    IF v_ceiling.min_quotations IS NOT NULL AND v_bid_count < v_ceiling.min_quotations THEN
      RAISE EXCEPTION 'Minimum % bids required for %. Only % recorded.',
        v_ceiling.min_quotations, v_proc.procurement_method, v_bid_count;
    END IF;
  END IF;

  -- (e) Entering post_qualification: require at least one responsive+eligible+compliant bid
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

  -- (f) Leaving post_qualification → bac_resolution / award_recommended: require notes
  IF v_proc.current_stage = 'post_qualification'
     AND p_next_stage IN ('award_recommended', 'bac_resolution')
  THEN
    IF COALESCE(LENGTH(TRIM(p_notes)), 0) < 10 THEN
      RAISE EXCEPTION 'Post-qualification verdict requires a notes entry of at least 10 characters (e.g. "LCB passed post-qualification on docs/specs/NFCC").';
    END IF;
  END IF;

  -- (g) Entering bac_resolution: require BAC quorum
  IF p_next_stage = 'bac_resolution' THEN
    IF NOT procurements.procurement_has_bac_quorum(p_procurement_id) THEN
      RAISE EXCEPTION 'BAC quorum not met. At least % distinct BAC evaluators must record evaluations before BAC resolution.',
        COALESCE(v_ceiling.min_bac_quorum, 3);
    END IF;
  END IF;

  -- (h) Entering award_recommended (competitive bidding): require awarded_supplier_id set
  IF p_next_stage = 'award_recommended' AND v_proc.procurement_method = 'competitive_bidding' THEN
    IF v_proc.awarded_supplier_id IS NULL THEN
      RAISE EXCEPTION 'Cannot advance to award_recommended: use the Recommend Award action on the Bids page first.';
    END IF;
  END IF;

  -- (i) Entering contract_signing: require performance security if required
  IF p_next_stage = 'contract_signing' THEN
    IF v_proc.performance_security_required
       AND v_proc.performance_security_received_at IS NULL
    THEN
      RAISE EXCEPTION 'Performance security must be recorded before contract signing. Update the performance security fields first.';
    END IF;
  END IF;

  -- ================================================================
  -- VALIDATION GATES — Phase 10 methods
  -- ================================================================

  -- Direct Contracting: require justification before BAC reviews
  IF v_proc.procurement_method = 'direct_contracting' THEN
    IF p_next_stage = 'bac_recommendation' THEN
      IF v_proc.justification_text IS NULL OR LENGTH(TRIM(v_proc.justification_text)) < 10 THEN
        RAISE EXCEPTION 'Written justification is required before BAC can review Direct Contracting. Use the method details form to provide the justification.';
      END IF;
    END IF;
    IF p_next_stage = 'hope_approval' THEN
      IF COALESCE(LENGTH(TRIM(p_notes)), 0) < 10 THEN
        RAISE EXCEPTION 'BAC recommendation notes (≥ 10 characters) are required before advancing to SDS approval.';
      END IF;
    END IF;
    IF p_next_stage = 'contract_signing' THEN
      IF v_proc.awarded_supplier_id IS NULL THEN
        RAISE EXCEPTION 'A supplier must be assigned before contract signing. Use the Assign Supplier action first.';
      END IF;
    END IF;
  END IF;

  -- Repeat Order: validate reference + price cap
  IF v_proc.procurement_method = 'repeat_order' THEN
    IF p_next_stage = 'price_verification' THEN
      IF v_proc.reference_procurement_id IS NULL THEN
        RAISE EXCEPTION 'A reference to the original procurement is required before price verification.';
      END IF;
      -- Validate 6-month window from original contract completion
      IF EXISTS (
        SELECT 1 FROM procurements.procurement_activities
         WHERE id = v_proc.reference_procurement_id
           AND (
             -- Original must have completed within the last 6 months
             updated_at < NOW() - INTERVAL '6 months'
           )
      ) THEN
        RAISE EXCEPTION 'Repeat Order must be within 6 months of the original contract completion. The referenced procurement is older than 6 months.';
      END IF;
    END IF;
    IF p_next_stage = 'bac_confirmation' THEN
      IF v_proc.price_increase_percentage IS NOT NULL
         AND v_proc.price_increase_percentage > 25
      THEN
        RAISE EXCEPTION 'Repeat Order price increase cannot exceed 25%% of the original contract. Current: %%%.', v_proc.price_increase_percentage;
      END IF;
    END IF;
    IF p_next_stage = 'po_issued' THEN
      IF v_proc.awarded_supplier_id IS NULL THEN
        RAISE EXCEPTION 'A supplier must be assigned before issuing PO.';
      END IF;
    END IF;
  END IF;

  -- Emergency: require justification + purchase date tracking
  IF v_proc.procurement_method = 'emergency' THEN
    IF p_next_stage = 'purchase_documentation' THEN
      IF v_proc.emergency_justification IS NULL OR LENGTH(TRIM(v_proc.emergency_justification)) < 10 THEN
        RAISE EXCEPTION 'Emergency justification is required before proceeding to documentation.';
      END IF;
      IF v_proc.emergency_type IS NULL THEN
        RAISE EXCEPTION 'Emergency type must be specified (calamity, imminent_danger, or other).';
      END IF;
      -- Auto-stamp purchase date and review deadline if not already set
      UPDATE procurements.procurement_activities
         SET emergency_purchase_date   = COALESCE(emergency_purchase_date, CURRENT_DATE),
             emergency_review_deadline = COALESCE(emergency_review_deadline, CURRENT_DATE + 30),
             updated_at                = NOW()
       WHERE id = p_procurement_id;
      -- Re-read so subsequent logic sees updated values
      SELECT * INTO v_proc FROM procurements.procurement_activities WHERE id = p_procurement_id;
    END IF;
    IF p_next_stage = 'bac_post_review' THEN
      IF v_proc.emergency_purchase_date IS NULL THEN
        RAISE EXCEPTION 'Emergency purchase date must be recorded before BAC post-review.';
      END IF;
      IF v_proc.awarded_supplier_id IS NULL THEN
        RAISE EXCEPTION 'A supplier and purchase amount must be recorded before BAC post-review.';
      END IF;
    END IF;
  END IF;

  -- Negotiated: verify eligibility + require negotiation records
  IF v_proc.procurement_method = 'negotiated' THEN
    IF p_next_stage = 'bac_negotiation' THEN
      -- Re-verify the 2-failure prerequisite (defense in depth)
      SELECT COUNT(*) INTO v_failed_count
        FROM procurements.procurement_activities
       WHERE purchase_request_id = v_proc.purchase_request_id
         AND status = 'failed'
         AND deleted_at IS NULL
         AND id <> p_procurement_id;
      IF v_failed_count < 2 THEN
        RAISE EXCEPTION 'Negotiated Procurement requires at least 2 prior failed biddings for this PR (found: %). Cannot proceed.', v_failed_count;
      END IF;
    END IF;
    IF p_next_stage = 'hope_approval' THEN
      IF v_proc.negotiation_records_note IS NULL OR LENGTH(TRIM(v_proc.negotiation_records_note)) < 10 THEN
        RAISE EXCEPTION 'BAC negotiation records (≥ 10 characters) must be provided before advancing to SDS approval.';
      END IF;
      IF v_proc.awarded_supplier_id IS NULL THEN
        RAISE EXCEPTION 'A supplier must be assigned before advancing to SDS approval.';
      END IF;
    END IF;
  END IF;

  -- Agency-to-Agency: require partner + MOA
  IF v_proc.procurement_method = 'agency_to_agency' THEN
    IF p_next_stage = 'moa_execution' THEN
      IF v_proc.partner_agency_name IS NULL OR LENGTH(TRIM(v_proc.partner_agency_name)) = 0 THEN
        RAISE EXCEPTION 'Partner agency name is required before MOA execution.';
      END IF;
      IF v_proc.moa_reference IS NULL OR LENGTH(TRIM(v_proc.moa_reference)) = 0 THEN
        RAISE EXCEPTION 'MOA/MOU reference number is required before MOA execution.';
      END IF;
      IF v_proc.awarded_supplier_id IS NULL THEN
        RAISE EXCEPTION 'A supplier (the partner agency) must be assigned before MOA execution. Use the Assign Supplier action.';
      END IF;
    END IF;
  END IF;

  -- ================================================================
  -- Apply the stage transition
  -- ================================================================

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

-- ============================================================
-- 4. set_procurement_supplier() — direct supplier assignment
--    for non-competitive methods (no bid pipeline)
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.set_procurement_supplier(
  p_procurement_id  UUID,
  p_supplier_id     UUID,
  p_contract_amount NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc     RECORD;
  v_supplier RECORD;
BEGIN
  IF NOT procurements.has_permission('proc.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to assign supplier';
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
    RAISE EXCEPTION 'Cannot assign supplier to a % procurement', v_proc.status;
  END IF;

  -- Only for non-competitive methods (competitive ones use the bid pipeline)
  IF v_proc.procurement_method IN ('svp', 'shopping', 'competitive_bidding') THEN
    RAISE EXCEPTION 'Use the bid recording and evaluation pipeline for % procurements', v_proc.procurement_method;
  END IF;

  SELECT * INTO v_supplier
    FROM procurements.suppliers
   WHERE id = p_supplier_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier % not found', p_supplier_id;
  END IF;

  IF p_contract_amount IS NULL OR p_contract_amount <= 0 THEN
    RAISE EXCEPTION 'Contract amount must be greater than zero';
  END IF;

  IF p_contract_amount > v_proc.abc_amount THEN
    RAISE EXCEPTION 'Contract amount (%) cannot exceed the Approved Budget for the Contract (%)',
      p_contract_amount, v_proc.abc_amount;
  END IF;

  UPDATE procurements.procurement_activities
     SET awarded_supplier_id = p_supplier_id,
         contract_amount     = p_contract_amount,
         updated_at          = NOW()
   WHERE id = p_procurement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.set_procurement_supplier(UUID, UUID, NUMERIC) TO authenticated;

-- ============================================================
-- 5. Method-specific metadata RPCs
-- ============================================================

-- Direct Contracting justification
CREATE OR REPLACE FUNCTION procurements.set_direct_contracting_justification(
  p_procurement_id         UUID,
  p_justification_type     TEXT,
  p_justification_text     TEXT,
  p_price_reasonableness   TEXT
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE v_proc RECORD;
BEGIN
  IF NOT procurements.has_permission('proc.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  SELECT * INTO v_proc FROM procurements.procurement_activities
   WHERE id = p_procurement_id AND division_id = procurements.get_user_division_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Procurement not found'; END IF;
  IF v_proc.procurement_method <> 'direct_contracting' THEN
    RAISE EXCEPTION 'This action is only for Direct Contracting procurements';
  END IF;
  IF p_justification_type NOT IN ('proprietary', 'exclusive_dealer', 'critical_component') THEN
    RAISE EXCEPTION 'Invalid justification type: %', p_justification_type;
  END IF;
  UPDATE procurements.procurement_activities
     SET justification_type       = p_justification_type,
         justification_text       = TRIM(p_justification_text),
         price_reasonableness_note = TRIM(p_price_reasonableness),
         updated_at               = NOW()
   WHERE id = p_procurement_id;
END; $$;
GRANT EXECUTE ON FUNCTION procurements.set_direct_contracting_justification(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- Repeat Order reference
CREATE OR REPLACE FUNCTION procurements.set_repeat_order_reference(
  p_procurement_id            UUID,
  p_reference_procurement_id  UUID,
  p_price_increase_percentage NUMERIC
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE v_proc RECORD; v_ref RECORD;
BEGIN
  IF NOT procurements.has_permission('proc.manage') THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  SELECT * INTO v_proc FROM procurements.procurement_activities
   WHERE id = p_procurement_id AND division_id = procurements.get_user_division_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Procurement not found'; END IF;
  IF v_proc.procurement_method <> 'repeat_order' THEN
    RAISE EXCEPTION 'This action is only for Repeat Order procurements';
  END IF;
  SELECT * INTO v_ref FROM procurements.procurement_activities WHERE id = p_reference_procurement_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Referenced procurement not found'; END IF;
  IF v_ref.status <> 'completed' THEN RAISE EXCEPTION 'Referenced procurement must be completed'; END IF;
  UPDATE procurements.procurement_activities
     SET reference_procurement_id  = p_reference_procurement_id,
         original_contract_date    = (SELECT MAX(completed_at)::DATE FROM procurements.procurement_stages WHERE procurement_id = p_reference_procurement_id AND stage = 'completed'),
         price_increase_percentage = p_price_increase_percentage,
         updated_at                = NOW()
   WHERE id = p_procurement_id;
END; $$;
GRANT EXECUTE ON FUNCTION procurements.set_repeat_order_reference(UUID, UUID, NUMERIC) TO authenticated;

-- Emergency details
CREATE OR REPLACE FUNCTION procurements.set_emergency_details(
  p_procurement_id        UUID,
  p_emergency_type        TEXT,
  p_emergency_justification TEXT,
  p_emergency_purchase_date DATE
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE v_proc RECORD;
BEGIN
  IF NOT procurements.has_permission('proc.manage') THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  SELECT * INTO v_proc FROM procurements.procurement_activities
   WHERE id = p_procurement_id AND division_id = procurements.get_user_division_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Procurement not found'; END IF;
  IF v_proc.procurement_method <> 'emergency' THEN
    RAISE EXCEPTION 'This action is only for Emergency procurements';
  END IF;
  IF p_emergency_type NOT IN ('calamity', 'imminent_danger', 'other') THEN
    RAISE EXCEPTION 'Invalid emergency type: %. Use: calamity, imminent_danger, other', p_emergency_type;
  END IF;
  UPDATE procurements.procurement_activities
     SET emergency_type            = p_emergency_type,
         emergency_justification   = TRIM(p_emergency_justification),
         emergency_purchase_date   = p_emergency_purchase_date,
         emergency_review_deadline = p_emergency_purchase_date + 30,
         updated_at                = NOW()
   WHERE id = p_procurement_id;
END; $$;
GRANT EXECUTE ON FUNCTION procurements.set_emergency_details(UUID, TEXT, TEXT, DATE) TO authenticated;

-- Negotiation details
CREATE OR REPLACE FUNCTION procurements.set_negotiation_details(
  p_procurement_id        UUID,
  p_negotiation_records   TEXT
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE v_proc RECORD;
BEGIN
  IF NOT procurements.has_permission('proc.manage') THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  SELECT * INTO v_proc FROM procurements.procurement_activities
   WHERE id = p_procurement_id AND division_id = procurements.get_user_division_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Procurement not found'; END IF;
  IF v_proc.procurement_method <> 'negotiated' THEN
    RAISE EXCEPTION 'This action is only for Negotiated Procurement';
  END IF;
  UPDATE procurements.procurement_activities
     SET negotiation_records_note = TRIM(p_negotiation_records),
         updated_at               = NOW()
   WHERE id = p_procurement_id;
END; $$;
GRANT EXECUTE ON FUNCTION procurements.set_negotiation_details(UUID, TEXT) TO authenticated;

-- Agency-to-Agency details
CREATE OR REPLACE FUNCTION procurements.set_agency_to_agency_details(
  p_procurement_id   UUID,
  p_partner_agency   TEXT,
  p_moa_reference    TEXT,
  p_moa_date         DATE
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE v_proc RECORD;
BEGIN
  IF NOT procurements.has_permission('proc.manage') THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  SELECT * INTO v_proc FROM procurements.procurement_activities
   WHERE id = p_procurement_id AND division_id = procurements.get_user_division_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Procurement not found'; END IF;
  IF v_proc.procurement_method <> 'agency_to_agency' THEN
    RAISE EXCEPTION 'This action is only for Agency-to-Agency procurements';
  END IF;
  UPDATE procurements.procurement_activities
     SET partner_agency_name = TRIM(p_partner_agency),
         moa_reference       = TRIM(p_moa_reference),
         moa_date            = p_moa_date,
         updated_at          = NOW()
   WHERE id = p_procurement_id;
END; $$;
GRANT EXECUTE ON FUNCTION procurements.set_agency_to_agency_details(UUID, TEXT, TEXT, DATE) TO authenticated;
