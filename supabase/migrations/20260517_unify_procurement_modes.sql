-- Phase 2: Procurement mode vocabulary unification
--
-- Standardizes procurement modes across PPMP → APP → Execution pipeline.
-- Canonical enum (aligned with execution engine already in use):
--   competitive_bidding, limited_source_bidding, direct_contracting,
--   repeat_order, shopping, svp, negotiated, agency_to_agency, emergency
--
-- Adds limited_source_bidding to the execution engine (ceilings, activity
-- creation, stage advancement).

-- ============================================================
-- 1. Backfill PPMP lots — rename old PPMP-only mode names
-- ============================================================
UPDATE procurements.ppmp_lots
   SET procurement_mode = 'svp'
 WHERE procurement_mode = 'small_value';

UPDATE procurements.ppmp_lots
   SET procurement_mode = 'negotiated'
 WHERE procurement_mode = 'negotiated_procurement';

UPDATE procurements.ppmp_lots
   SET procurement_mode = 'competitive_bidding'
 WHERE procurement_mode IN ('two_stage_bidding', 'by_administration');

-- ============================================================
-- 2. Backfill APP items
-- ============================================================
UPDATE procurements.app_items
   SET procurement_mode = 'svp'
 WHERE procurement_mode = 'small_value';

UPDATE procurements.app_items
   SET procurement_mode = 'negotiated'
 WHERE procurement_mode = 'negotiated_procurement';

UPDATE procurements.app_items
   SET procurement_mode = 'competitive_bidding'
 WHERE procurement_mode IN ('two_stage_bidding', 'by_administration');

-- ============================================================
-- 3. Backfill purchase requests
-- ============================================================
UPDATE procurements.purchase_requests
   SET procurement_mode = 'svp'
 WHERE procurement_mode = 'small_value';

UPDATE procurements.purchase_requests
   SET procurement_mode = 'negotiated'
 WHERE procurement_mode = 'negotiated_procurement';

UPDATE procurements.purchase_requests
   SET procurement_mode = 'competitive_bidding'
 WHERE procurement_mode IN ('two_stage_bidding', 'by_administration');

-- ============================================================
-- 4. Add CHECK constraints to enforce canonical modes
-- ============================================================
ALTER TABLE procurements.ppmp_lots
  ADD CONSTRAINT chk_ppmp_lot_procurement_mode
  CHECK (procurement_mode IN (
    'competitive_bidding','limited_source_bidding','direct_contracting',
    'repeat_order','shopping','svp','negotiated','agency_to_agency','emergency'
  ));

ALTER TABLE procurements.app_items
  ADD CONSTRAINT chk_app_item_procurement_mode
  CHECK (procurement_mode IS NULL OR procurement_mode IN (
    'competitive_bidding','limited_source_bidding','direct_contracting',
    'repeat_order','shopping','svp','negotiated','agency_to_agency','emergency'
  ));

-- ============================================================
-- 5. Add limited_source_bidding to procurement_method_ceilings
-- ============================================================
INSERT INTO procurements.procurement_method_ceilings (
  procurement_mode, ceiling_amount, effective_from, ra_reference, notes,
  min_quotations, min_posting_days, requires_philgeps_publication,
  ngpa_section, display_name,
  requires_bid_security, requires_performance_security, min_bac_quorum
) VALUES (
  'limited_source_bidding', NULL, '2024-07-26',
  'RA 9184 Sec 49 / RA 12009 IRR', 'Specialized goods/services with known limited suppliers',
  3, 7, TRUE,
  'RA 9184 Section 49 / RA 12009 IRR — Limited Source Bidding',
  'Limited Source Bidding',
  TRUE, TRUE, 3
)
ON CONFLICT (procurement_mode) DO NOTHING;

-- ============================================================
-- 6. Extend create_procurement_activity() to accept limited_source_bidding
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
    'negotiated', 'agency_to_agency', 'limited_source_bidding'
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
    WHEN 'svp'                   THEN v_first_stage := 'rfq_preparation';
    WHEN 'shopping'              THEN v_first_stage := 'canvass_preparation';
    WHEN 'competitive_bidding'   THEN v_first_stage := 'bid_document_preparation';
    WHEN 'direct_contracting'    THEN v_first_stage := 'justification_prepared';
    WHEN 'repeat_order'          THEN v_first_stage := 'reference_verification';
    WHEN 'emergency'             THEN v_first_stage := 'emergency_purchase';
    WHEN 'negotiated'            THEN v_first_stage := 'eligibility_verification';
    WHEN 'agency_to_agency'      THEN v_first_stage := 'agency_identification';
    WHEN 'limited_source_bidding' THEN v_first_stage := 'pre_qualification';
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
-- 7. Extend advance_procurement_stage() with limited_source_bidding
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
    WHEN 'limited_source_bidding' THEN
      v_valid_stages := ARRAY[
        'created', 'pre_qualification', 'itb_published', 'bid_submission',
        'bid_opening', 'evaluation', 'post_qualification',
        'award_recommended', 'award_approved', 'contract_signing', 'completed'
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
  -- VALIDATION GATES
  -- ================================================================

  -- (a) Entering posting stages: stamp posting + require PhilGEPS ref
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

  -- (b) Entering receiving stages: enforce deadline
  IF p_next_stage IN ('quotations_received', 'canvass_received', 'bid_submission') THEN
    IF v_proc.submission_deadline IS NOT NULL
       AND NOW() < v_proc.submission_deadline
       AND COALESCE(LENGTH(TRIM(p_notes)), 0) < 10
    THEN
      RAISE EXCEPTION 'Submission deadline (%) has not yet passed. Provide a justification of at least 10 characters in notes to proceed early.',
        v_proc.submission_deadline;
    END IF;
  END IF;

  -- (c) Entering bid_opening: require at least 1 bid
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
      RAISE EXCEPTION 'Minimum % bids required (found: %). Record more bids or declare failure.',
        v_ceiling.min_quotations, v_bid_count;
    END IF;
  END IF;

  -- (e) Direct Contracting: justification required before bac_recommendation
  IF v_proc.procurement_method = 'direct_contracting'
     AND p_next_stage = 'bac_recommendation'
  THEN
    IF v_proc.justification_type IS NULL OR COALESCE(LENGTH(TRIM(v_proc.justification_text)), 0) < 10 THEN
      RAISE EXCEPTION 'Direct Contracting requires justification_type and justification_text (min 10 chars) before BAC recommendation.';
    END IF;
  END IF;

  -- (f) Repeat Order: 6-month window + max 25% price increase
  IF v_proc.procurement_method = 'repeat_order'
     AND p_next_stage = 'price_verification'
  THEN
    IF v_proc.reference_procurement_id IS NOT NULL THEN
      DECLARE
        v_orig_date DATE;
        v_pct NUMERIC;
      BEGIN
        SELECT original_contract_date INTO v_orig_date
          FROM procurements.procurement_activities
         WHERE id = p_procurement_id;

        IF v_orig_date IS NOT NULL AND (NOW()::DATE - v_orig_date) > 180 THEN
          RAISE EXCEPTION 'Repeat Order window expired: original contract date (%) is more than 6 months ago.', v_orig_date;
        END IF;

        SELECT price_increase_percentage INTO v_pct
          FROM procurements.procurement_activities
         WHERE id = p_procurement_id;

        IF v_pct IS NOT NULL AND v_pct > 25 THEN
          RAISE EXCEPTION 'Price increase (%%%) exceeds 25%% maximum allowed for Repeat Order.', v_pct;
        END IF;
      END;
    END IF;
  END IF;

  -- (g) Emergency: type and justification required
  IF v_proc.procurement_method = 'emergency'
     AND p_next_stage = 'purchase_documentation'
  THEN
    IF v_proc.emergency_type IS NULL OR COALESCE(LENGTH(TRIM(v_proc.emergency_justification)), 0) < 10 THEN
      RAISE EXCEPTION 'Emergency procurement requires emergency_type and emergency_justification (min 10 chars).';
    END IF;

    -- Auto-stamp 30-day BAC review deadline if not set
    IF v_proc.emergency_review_deadline IS NULL THEN
      UPDATE procurements.procurement_activities
         SET emergency_review_deadline = NOW() + INTERVAL '30 days'
       WHERE id = p_procurement_id;
    END IF;
  END IF;

  -- (h) Negotiated: require 2 prior failed biddings
  IF v_proc.procurement_method = 'negotiated'
     AND p_next_stage = 'bac_negotiation'
  THEN
    SELECT COUNT(*) INTO v_failed_count
      FROM procurements.procurement_activities
     WHERE purchase_request_id = v_proc.purchase_request_id
       AND status = 'failed'
       AND deleted_at IS NULL
       AND id <> p_procurement_id;

    IF v_failed_count < 2 THEN
      RAISE EXCEPTION 'Negotiated Procurement requires at least 2 prior failed biddings (found: %).', v_failed_count;
    END IF;
  END IF;

  -- (i) Agency-to-Agency: MOA reference + partner agency required
  IF v_proc.procurement_method = 'agency_to_agency'
     AND p_next_stage = 'moa_execution'
  THEN
    IF COALESCE(NULLIF(TRIM(v_proc.partner_agency_name), ''), NULL) IS NULL THEN
      RAISE EXCEPTION 'Agency-to-Agency procurement requires partner_agency_name before MOA execution.';
    END IF;
    IF COALESCE(NULLIF(TRIM(v_proc.moa_reference), ''), NULL) IS NULL THEN
      RAISE EXCEPTION 'Agency-to-Agency procurement requires moa_reference before MOA execution.';
    END IF;
  END IF;

  -- (j) Limited Source Bidding: PhilGEPS required before itb_published
  IF v_proc.procurement_method = 'limited_source_bidding'
     AND p_next_stage = 'itb_published'
  THEN
    IF v_ceiling.requires_philgeps_publication
       AND COALESCE(NULLIF(TRIM(v_proc.philgeps_reference), ''), NULL) IS NULL
    THEN
      RAISE EXCEPTION 'PhilGEPS reference is required before publishing ITB for Limited Source Bidding.';
    END IF;

    v_posting_days := COALESCE(v_proc.posting_required_days, v_ceiling.min_posting_days, 7);
    v_deadline := NOW() + (v_posting_days || ' days')::INTERVAL;

    UPDATE procurements.procurement_activities
       SET posting_date          = COALESCE(posting_date, NOW()),
           submission_deadline   = COALESCE(submission_deadline, v_deadline),
           philgeps_published_at = CASE
             WHEN philgeps_published_at IS NULL THEN NOW()
             ELSE philgeps_published_at
           END
     WHERE id = p_procurement_id;
  END IF;

  -- (k) Limited Source Bidding: enforce deadline before bid_submission
  IF v_proc.procurement_method = 'limited_source_bidding'
     AND p_next_stage = 'bid_submission'
  THEN
    IF v_proc.submission_deadline IS NOT NULL
       AND NOW() < v_proc.submission_deadline
       AND COALESCE(LENGTH(TRIM(p_notes)), 0) < 10
    THEN
      RAISE EXCEPTION 'Submission deadline (%) has not yet passed. Provide a justification of at least 10 characters in notes to proceed early.',
        v_proc.submission_deadline;
    END IF;
  END IF;

  -- ----------------------------------------------------------------
  -- Apply the stage transition
  -- ----------------------------------------------------------------

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
