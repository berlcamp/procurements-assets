-- Phase 9: Competitive Bidding Workflow
--
-- Extends the procurement engine to support the full 17-step Competitive
-- Bidding workflow per RA 12009 (Government Procurement Reform Act).
--
-- This migration:
--   1. Extends create_procurement_activity() to accept 'competitive_bidding'
--   2. Extends advance_procurement_stage() with 18-stage competitive bidding
--      sequence and RA 12009 validation gates
--   3. Extends award_procurement() to handle competitive bidding stages
--   4. Extends record_bid() with bid security enforcement
--   5. Extends get_procurement_summary() with competitive_bidding_count
--
-- Stage sequence:
--   created → bid_document_preparation → pre_procurement_conference →
--   itb_published → pre_bid_conference → bid_submission → bid_opening →
--   preliminary_examination → technical_evaluation → financial_evaluation →
--   post_qualification → bac_resolution →
--   award_recommended → award_approved →
--   noa_issued → contract_signing → ntp_issued → completed
--
-- Non-destructive. All existing SVP/Shopping logic preserved.

-- ============================================================
-- 1. Extend create_procurement_activity()
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.create_procurement_activity(
  p_pr_id  UUID,
  p_method TEXT
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
BEGIN
  IF NOT (procurements.has_permission('proc.create') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to create procurement activities';
  END IF;

  IF p_method NOT IN ('svp', 'shopping', 'competitive_bidding') THEN
    RAISE EXCEPTION 'Invalid procurement method: %. Supported: SVP, Shopping, Competitive Bidding', p_method;
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
    RAISE EXCEPTION 'Purchase Request % already has a procurement activity', p_pr_id;
  END IF;

  v_proc_number := procurements.generate_procurement_number(
    v_pr.office_id, v_pr.fiscal_year_id, v_pr.division_id
  );

  CASE p_method
    WHEN 'svp'                THEN v_first_stage := 'rfq_preparation';
    WHEN 'shopping'           THEN v_first_stage := 'canvass_preparation';
    WHEN 'competitive_bidding' THEN v_first_stage := 'bid_document_preparation';
  END CASE;

  INSERT INTO procurements.procurement_activities (
    division_id, procurement_number, office_id, fiscal_year_id,
    purchase_request_id, procurement_method, abc_amount,
    current_stage, status, created_by
  ) VALUES (
    v_pr.division_id, v_proc_number, v_pr.office_id, v_pr.fiscal_year_id,
    p_pr_id, p_method, v_pr.total_estimated_cost,
    v_first_stage, 'active', v_user_id
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
-- 2. Extend advance_procurement_stage() with competitive bidding
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

  -- ----------------------------------------------------------------
  -- Pre-bid conference skip for competitive bidding (ABC <= 1M)
  -- Auto-insert a completed stage with waiver note
  -- ----------------------------------------------------------------
  IF v_proc.procurement_method = 'competitive_bidding'
     AND v_proc.current_stage = 'itb_published'
     AND p_next_stage = 'bid_submission'
     AND v_proc.abc_amount <= 1000000
  THEN
    -- Auto-complete pre_bid_conference as waived
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
  -- VALIDATION GATES
  -- ================================================================

  -- (a) Entering rfq_sent / canvass_sent / itb_published: stamp posting + require PhilGEPS ref
  IF p_next_stage IN ('rfq_sent', 'canvass_sent', 'itb_published') THEN
    IF v_ceiling.requires_philgeps_publication
       AND COALESCE(NULLIF(TRIM(v_proc.philgeps_reference), ''), NULL) IS NULL
    THEN
      RAISE EXCEPTION 'PhilGEPS reference is required before advancing to %. Set procurement_activities.philgeps_reference first.',
        p_next_stage;
    END IF;

    -- Compute posting days: for competitive bidding, tier by ABC amount
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

  -- (f) Leaving post_qualification → bac_resolution (competitive) or award_recommended (SVP/Shopping):
  --     require notes documenting the verdict
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
-- 3. Extend award_procurement() for competitive bidding
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

  -- Refuse if already past award_recommended
  IF v_proc.current_stage IN ('award_approved', 'noa_issued', 'contract_signing', 'ntp_issued', 'completed') THEN
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

  -- ----------------------------------------------------------------
  -- Apply the award
  -- ----------------------------------------------------------------

  -- Demote any previously-awarded bid back to evaluated (allows reselection)
  UPDATE procurements.bids
     SET status     = 'evaluated',
         updated_at = NOW()
   WHERE procurement_id = p_procurement_id
     AND status         = 'awarded'
     AND id             <> p_bid_id;

  UPDATE procurements.bids
     SET status     = 'awarded',
         updated_at = NOW()
   WHERE id = p_bid_id;

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

  -- ----------------------------------------------------------------
  -- Stage handling
  -- For competitive_bidding: award is selected at bac_resolution, but
  -- advance_procurement_stage handles moving to award_recommended.
  -- For SVP/Shopping: advance directly if not already at award_recommended.
  -- ----------------------------------------------------------------
  IF v_proc.current_stage <> 'award_recommended' AND v_proc.procurement_method <> 'competitive_bidding' THEN
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

-- ============================================================
-- 4. Extend record_bid() with bid security enforcement
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.record_bid(
  p_procurement_id        UUID,
  p_supplier_id           UUID,
  p_items                 JSONB,
  p_lot_id                UUID DEFAULT NULL,
  p_bid_security_amount   NUMERIC DEFAULT NULL,
  p_bid_security_form     TEXT    DEFAULT NULL,
  p_bid_security_reference TEXT   DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc        RECORD;
  v_ceiling     RECORD;
  v_supplier    RECORD;
  v_lot         RECORD;
  v_bid_id      UUID;
  v_bid_amount  NUMERIC := 0;
  v_item        JSONB;
  v_eligibility JSONB;
  v_has_lots    BOOLEAN;
  v_ceiling_amt NUMERIC;
  v_required_security NUMERIC;
BEGIN
  IF NOT (procurements.has_permission('bid.record') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to record bids';
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
    RAISE EXCEPTION 'Cannot record bids on a % procurement', v_proc.status;
  END IF;

  SELECT * INTO v_ceiling
    FROM procurements.procurement_method_ceilings
   WHERE procurement_mode = v_proc.procurement_method;

  SELECT * INTO v_supplier
    FROM procurements.suppliers
   WHERE id         = p_supplier_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier % not found', p_supplier_id;
  END IF;

  IF v_supplier.status <> 'active' THEN
    RAISE EXCEPTION 'Supplier % is % and cannot submit bids', v_supplier.name, v_supplier.status;
  END IF;

  -- Eligibility documents
  v_eligibility := procurements.supplier_eligibility_check(p_supplier_id, v_proc.procurement_method);
  IF (v_eligibility->>'is_eligible')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION
      'Supplier % is not eligible to bid: missing %, expired %. Verify the required RA 12009 documents on the supplier profile first.',
      v_supplier.name,
      COALESCE((v_eligibility->'missing')::TEXT, '[]'),
      COALESCE((v_eligibility->'expired')::TEXT, '[]');
  END IF;

  -- ---- Bid security enforcement ----
  IF v_ceiling.requires_bid_security THEN
    IF p_bid_security_amount IS NULL THEN
      RAISE EXCEPTION 'Bid security is required for %. Provide bid_security_amount, bid_security_form, and bid_security_reference.',
        v_ceiling.display_name;
    END IF;

    v_required_security := v_proc.abc_amount * COALESCE(v_ceiling.bid_security_percentage, 0.02);
    IF p_bid_security_amount < v_required_security THEN
      RAISE EXCEPTION 'Bid security amount (₱%) is below the required minimum (₱%) for ABC ₱%.',
        p_bid_security_amount, v_required_security, v_proc.abc_amount;
    END IF;

    IF p_bid_security_form IS NULL THEN
      RAISE EXCEPTION 'Bid security form is required (cash, bank_draft, managers_check, irrevocable_loc, surety_bond, or bank_guarantee).';
    END IF;
  END IF;

  -- ---- Lot handling ----
  v_has_lots := procurements.procurement_has_lots(p_procurement_id);

  IF v_has_lots THEN
    IF p_lot_id IS NULL THEN
      RAISE EXCEPTION 'This procurement has lots; lot_id is required when recording a bid';
    END IF;

    SELECT * INTO v_lot
      FROM procurements.procurement_lots
     WHERE id             = p_lot_id
       AND procurement_id = p_procurement_id
       AND deleted_at     IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lot % does not belong to this procurement', p_lot_id;
    END IF;

    IF v_lot.status <> 'open' THEN
      RAISE EXCEPTION 'Cannot bid on lot %; status is %', v_lot.lot_number, v_lot.status;
    END IF;

    v_ceiling_amt := v_lot.abc_amount;

    IF EXISTS (
      SELECT 1 FROM procurements.bids
       WHERE procurement_id = p_procurement_id
         AND supplier_id    = p_supplier_id
         AND lot_id         = p_lot_id
         AND deleted_at     IS NULL
    ) THEN
      RAISE EXCEPTION 'Supplier % already has a bid on lot %', v_supplier.name, v_lot.lot_number;
    END IF;
  ELSE
    IF p_lot_id IS NOT NULL THEN
      RAISE EXCEPTION 'This procurement has no lots; lot_id must be NULL';
    END IF;

    v_ceiling_amt := v_proc.abc_amount;

    IF EXISTS (
      SELECT 1 FROM procurements.bids
       WHERE procurement_id = p_procurement_id
         AND supplier_id    = p_supplier_id
         AND lot_id         IS NULL
         AND deleted_at     IS NULL
    ) THEN
      RAISE EXCEPTION 'Supplier % already has a bid on this procurement', v_supplier.name;
    END IF;
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one bid item is required';
  END IF;

  SELECT COALESCE(SUM((item->>'offered_total_cost')::NUMERIC), 0)
    INTO v_bid_amount
    FROM jsonb_array_elements(p_items) AS item;

  IF v_bid_amount > v_ceiling_amt THEN
    RAISE EXCEPTION 'Bid amount (₱%) exceeds the ABC (₱%) for this %',
      v_bid_amount, v_ceiling_amt, CASE WHEN v_has_lots THEN 'lot' ELSE 'procurement' END;
  END IF;

  INSERT INTO procurements.bids (
    procurement_id, supplier_id, lot_id, bid_amount, bid_date,
    status, office_id,
    bid_security_amount, bid_security_form, bid_security_reference,
    bid_security_received_at
  ) VALUES (
    p_procurement_id, p_supplier_id, p_lot_id, v_bid_amount, NOW(),
    'submitted', v_proc.office_id,
    p_bid_security_amount, p_bid_security_form, p_bid_security_reference,
    CASE WHEN p_bid_security_amount IS NOT NULL THEN NOW() ELSE NULL END
  )
  RETURNING id INTO v_bid_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO procurements.bid_items (
      bid_id, pr_item_id, offered_unit_cost, offered_total_cost,
      brand_model, specifications, remarks
    ) VALUES (
      v_bid_id,
      (v_item->>'pr_item_id')::UUID,
      (v_item->>'offered_unit_cost')::NUMERIC,
      (v_item->>'offered_total_cost')::NUMERIC,
      NULLIF(v_item->>'brand_model', ''),
      NULLIF(v_item->>'specifications', ''),
      NULLIF(v_item->>'remarks', '')
    );
  END LOOP;

  RETURN v_bid_id;
END;
$$;

-- ============================================================
-- 5. Extend get_procurement_summary() with competitive_bidding_count
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.get_procurement_summary(
  p_fiscal_year_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_division_id UUID := procurements.get_user_division_id();
  v_result      JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total',                    COUNT(*),
    'active',                   COUNT(*) FILTER (WHERE status = 'active'),
    'completed',                COUNT(*) FILTER (WHERE status = 'completed'),
    'failed',                   COUNT(*) FILTER (WHERE status = 'failed'),
    'svp_count',                COUNT(*) FILTER (WHERE procurement_method = 'svp'),
    'shopping_count',           COUNT(*) FILTER (WHERE procurement_method = 'shopping'),
    'competitive_bidding_count',COUNT(*) FILTER (WHERE procurement_method = 'competitive_bidding'),
    'total_abc',                COALESCE(SUM(abc_amount), 0)::TEXT,
    'total_awarded',            COALESCE(SUM(contract_amount) FILTER (WHERE status = 'completed'), 0)::TEXT,
    'total_savings',            COALESCE(SUM(savings_amount) FILTER (WHERE status = 'completed'), 0)::TEXT
  )
  INTO v_result
  FROM procurements.procurement_activities
  WHERE division_id    = v_division_id
    AND fiscal_year_id = p_fiscal_year_id
    AND deleted_at     IS NULL;

  RETURN COALESCE(v_result, '{}'::JSONB);
END;
$$;
