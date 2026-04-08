-- Phase 8: Procurement Workflows (SVP + Shopping) — RPC Functions

-- ============================================================
-- generate_procurement_number(p_office_id, p_fiscal_year_id, p_division_id)
-- Returns: PROC-{OFFICE_CODE}-{YEAR}-{NNNN}
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.generate_procurement_number(
  p_office_id      UUID,
  p_fiscal_year_id UUID,
  p_division_id    UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_office_code TEXT;
  v_year        INTEGER;
  v_next        INTEGER;
BEGIN
  SELECT code INTO v_office_code
    FROM procurements.offices
   WHERE id = p_office_id;

  SELECT year INTO v_year
    FROM procurements.fiscal_years
   WHERE id = p_fiscal_year_id;

  UPDATE procurements.sequence_counters
     SET last_value = last_value + 1
   WHERE division_id  = p_division_id
     AND office_id    = p_office_id
     AND counter_type = 'procurement'
     AND fiscal_year  = v_year
  RETURNING last_value INTO v_next;

  IF NOT FOUND THEN
    INSERT INTO procurements.sequence_counters
      (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
    VALUES
      (p_division_id, p_office_id, 'procurement', v_year, 1, 'PROC')
    RETURNING last_value INTO v_next;
  END IF;

  RETURN 'PROC-' || COALESCE(v_office_code, 'DIV') || '-' || v_year || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

-- ============================================================
-- create_procurement_activity(p_pr_id, p_method)
-- Creates procurement activity from an approved PR.
-- Sets PR status → 'in_procurement'.
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
  -- Permission check
  IF NOT (procurements.has_permission('proc.create') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to create procurement activities';
  END IF;

  -- Validate method
  IF p_method NOT IN ('svp', 'shopping') THEN
    RAISE EXCEPTION 'Invalid procurement method: %. Only SVP and Shopping are supported', p_method;
  END IF;

  -- Get and validate PR
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

  -- Check PR doesn't already have a procurement activity
  IF v_pr.procurement_id IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase Request % already has a procurement activity', p_pr_id;
  END IF;

  -- Generate procurement number
  v_proc_number := procurements.generate_procurement_number(
    v_pr.office_id, v_pr.fiscal_year_id, v_pr.division_id
  );

  -- Determine first active stage based on method
  CASE p_method
    WHEN 'svp'      THEN v_first_stage := 'rfq_preparation';
    WHEN 'shopping'  THEN v_first_stage := 'canvass_preparation';
  END CASE;

  -- Insert procurement activity
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

  -- Create stage records: 'created' as completed, first stage as current
  INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, completed_at, completed_by, office_id)
  VALUES (v_proc_id, 'created', 'completed', NOW(), NOW(), v_user_id, v_pr.office_id);

  INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, office_id)
  VALUES (v_proc_id, v_first_stage, 'current', NOW(), v_pr.office_id);

  -- Update PR: link to procurement and set status
  UPDATE procurements.purchase_requests
     SET procurement_id = v_proc_id,
         status         = 'in_procurement',
         updated_at     = NOW()
   WHERE id = p_pr_id;

  -- Update OBR: link to procurement
  UPDATE procurements.obligation_requests
     SET procurement_id = v_proc_id,
         updated_at     = NOW()
   WHERE purchase_request_id = p_pr_id
     AND deleted_at IS NULL;

  RETURN v_proc_id;
END;
$$;

-- ============================================================
-- record_bid(p_procurement_id, p_supplier_id, p_items)
-- Records a bid/quotation from a supplier.
-- p_items JSONB: [{ pr_item_id, offered_unit_cost, offered_total_cost, brand_model, specifications, remarks }]
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.record_bid(
  p_procurement_id UUID,
  p_supplier_id    UUID,
  p_items          JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc       RECORD;
  v_supplier   RECORD;
  v_bid_id     UUID;
  v_bid_amount NUMERIC := 0;
  v_item       JSONB;
BEGIN
  IF NOT (procurements.has_permission('bid.record') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to record bids';
  END IF;

  -- Validate procurement activity
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

  -- Validate supplier
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

  -- Check supplier not already bidding on this procurement
  IF EXISTS (
    SELECT 1 FROM procurements.bids
    WHERE procurement_id = p_procurement_id
      AND supplier_id    = p_supplier_id
      AND deleted_at     IS NULL
  ) THEN
    RAISE EXCEPTION 'Supplier % already has a bid on this procurement', v_supplier.name;
  END IF;

  -- Validate items not empty
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one bid item is required';
  END IF;

  -- Calculate total bid amount
  SELECT COALESCE(SUM((item->>'offered_total_cost')::NUMERIC), 0)
    INTO v_bid_amount
    FROM jsonb_array_elements(p_items) AS item;

  -- Validate bid amount does not exceed ABC
  IF v_bid_amount > v_proc.abc_amount THEN
    RAISE EXCEPTION 'Bid amount (₱%) exceeds the Approved Budget for the Contract (₱%)',
      v_bid_amount, v_proc.abc_amount;
  END IF;

  -- Insert bid
  INSERT INTO procurements.bids (
    procurement_id, supplier_id, bid_amount, bid_date,
    status, office_id
  ) VALUES (
    p_procurement_id, p_supplier_id, v_bid_amount, NOW(),
    'submitted', v_proc.office_id
  )
  RETURNING id INTO v_bid_id;

  -- Insert bid items
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
-- evaluate_bids(p_procurement_id, p_evaluations)
-- BAC evaluates all bids. Ranks responsive+eligible+compliant bids by amount ASC.
-- p_evaluations JSONB: [{ bid_id, is_responsive, is_eligible, is_compliant, evaluation_score, remarks }]
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
  v_proc RECORD;
  v_eval JSONB;
  v_rank INTEGER := 0;
  v_bid  RECORD;
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
    UPDATE procurements.bids
       SET is_responsive = COALESCE((v_eval->>'is_responsive')::BOOLEAN, is_responsive),
           is_eligible   = COALESCE((v_eval->>'is_eligible')::BOOLEAN, is_eligible),
           is_compliant  = COALESCE((v_eval->>'is_compliant')::BOOLEAN, is_compliant),
           evaluation_score = CASE
             WHEN v_eval->>'evaluation_score' IS NOT NULL
             THEN (v_eval->>'evaluation_score')::NUMERIC
             ELSE evaluation_score
           END,
           remarks = CASE
             WHEN v_eval->>'remarks' IS NOT NULL AND v_eval->>'remarks' <> ''
             THEN v_eval->>'remarks'
             ELSE remarks
           END,
           status     = 'evaluated',
           updated_at = NOW()
     WHERE id             = (v_eval->>'bid_id')::UUID
       AND procurement_id = p_procurement_id
       AND deleted_at     IS NULL;

    -- Disqualify non-responsive/eligible/compliant bids
    IF (v_eval->>'is_responsive')::BOOLEAN = FALSE
       OR (v_eval->>'is_eligible')::BOOLEAN = FALSE
       OR (v_eval->>'is_compliant')::BOOLEAN = FALSE THEN
      UPDATE procurements.bids
         SET status                  = 'disqualified',
             disqualification_reason = COALESCE(
               NULLIF(v_eval->>'remarks', ''),
               'Did not meet eligibility/responsiveness/compliance requirements'
             ),
             updated_at              = NOW()
       WHERE id             = (v_eval->>'bid_id')::UUID
         AND procurement_id = p_procurement_id;
    END IF;
  END LOOP;

  -- Rank responsive+eligible+compliant bids by bid_amount ASC
  v_rank := 0;
  FOR v_bid IN
    SELECT id FROM procurements.bids
     WHERE procurement_id = p_procurement_id
       AND deleted_at     IS NULL
       AND is_responsive  = TRUE
       AND is_eligible    = TRUE
       AND is_compliant   = TRUE
       AND status         = 'evaluated'
     ORDER BY bid_amount ASC
  LOOP
    v_rank := v_rank + 1;
    UPDATE procurements.bids SET rank = v_rank WHERE id = v_bid.id;
  END LOOP;
END;
$$;

-- ============================================================
-- advance_procurement_stage(p_procurement_id, p_next_stage, p_notes)
-- Progresses the workflow to the next stage.
-- Validates valid transitions per procurement method.
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
  v_valid_stages  TEXT[];
  v_current_idx   INTEGER;
  v_next_idx      INTEGER;
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

  -- Define valid stage sequences per method
  CASE v_proc.procurement_method
    WHEN 'svp' THEN
      v_valid_stages := ARRAY[
        'created', 'rfq_preparation', 'rfq_sent', 'quotations_received',
        'evaluation', 'abstract_prepared', 'award_recommended', 'award_approved', 'completed'
      ];
    WHEN 'shopping' THEN
      v_valid_stages := ARRAY[
        'created', 'canvass_preparation', 'canvass_sent', 'canvass_received',
        'comparison', 'award_recommended', 'award_approved', 'completed'
      ];
    ELSE
      RAISE EXCEPTION 'Stage advancement not yet implemented for method: %', v_proc.procurement_method;
  END CASE;

  -- Find current and next stage positions
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

  -- Complete current stage
  UPDATE procurements.procurement_stages
     SET status       = 'completed',
         completed_at = NOW(),
         completed_by = auth.uid(),
         notes        = COALESCE(p_notes, notes)
   WHERE procurement_id = p_procurement_id
     AND status          = 'current';

  -- Create new current stage
  INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, office_id)
  VALUES (p_procurement_id, p_next_stage, 'current', NOW(), v_proc.office_id);

  -- Update procurement current_stage
  UPDATE procurements.procurement_activities
     SET current_stage = p_next_stage,
         updated_at    = NOW()
   WHERE id = p_procurement_id;

  -- If stage is 'completed', mark procurement as completed
  IF p_next_stage = 'completed' THEN
    UPDATE procurements.procurement_activities
       SET status     = 'completed',
           updated_at = NOW()
     WHERE id = p_procurement_id;

    -- Update PR to completed
    UPDATE procurements.purchase_requests
       SET status     = 'completed',
           updated_at = NOW()
     WHERE id = v_proc.purchase_request_id;
  END IF;
END;
$$;

-- ============================================================
-- award_procurement(p_procurement_id, p_bid_id)
-- Awards procurement to a bid. Validates minimum bid count.
-- Advances stage to 'award_recommended'.
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
  v_proc            RECORD;
  v_bid             RECORD;
  v_responsive_count INTEGER;
  v_min_bids         INTEGER := 3;
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

  -- Must be at evaluation/abstract/comparison stage
  IF v_proc.procurement_method = 'svp' AND v_proc.current_stage NOT IN ('evaluation', 'abstract_prepared') THEN
    RAISE EXCEPTION 'SVP award can only be made at evaluation or abstract_prepared stage (current: %)', v_proc.current_stage;
  END IF;
  IF v_proc.procurement_method = 'shopping' AND v_proc.current_stage NOT IN ('comparison') THEN
    RAISE EXCEPTION 'Shopping award can only be made at comparison stage (current: %)', v_proc.current_stage;
  END IF;

  -- Validate the bid
  SELECT * INTO v_bid
    FROM procurements.bids
   WHERE id             = p_bid_id
     AND procurement_id = p_procurement_id
     AND deleted_at     IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bid % not found for this procurement', p_bid_id;
  END IF;

  IF NOT (v_bid.is_responsive AND v_bid.is_eligible AND v_bid.is_compliant) THEN
    RAISE EXCEPTION 'Cannot award to a bid that is not responsive, eligible, and compliant';
  END IF;

  -- Count responsive bids
  SELECT COUNT(*) INTO v_responsive_count
    FROM procurements.bids
   WHERE procurement_id = p_procurement_id
     AND deleted_at     IS NULL
     AND is_responsive  = TRUE
     AND is_eligible    = TRUE
     AND is_compliant   = TRUE;

  IF v_responsive_count < v_min_bids THEN
    RAISE EXCEPTION 'Minimum % responsive bids required for %. Only % found',
      v_min_bids,
      UPPER(v_proc.procurement_method),
      v_responsive_count;
  END IF;

  -- Validate contract amount does not exceed ABC
  IF v_bid.bid_amount > v_proc.abc_amount THEN
    RAISE EXCEPTION 'Bid amount (₱%) exceeds ABC (₱%)', v_bid.bid_amount, v_proc.abc_amount;
  END IF;

  -- Set award details on procurement
  UPDATE procurements.procurement_activities
     SET awarded_supplier_id = v_bid.supplier_id,
         contract_amount     = v_bid.bid_amount,
         updated_at          = NOW()
   WHERE id = p_procurement_id;

  -- Mark bid as awarded
  UPDATE procurements.bids
     SET status     = 'awarded',
         updated_at = NOW()
   WHERE id = p_bid_id;

  -- Advance to award_recommended
  -- Complete current stage
  UPDATE procurements.procurement_stages
     SET status       = 'completed',
         completed_at = NOW(),
         completed_by = auth.uid()
   WHERE procurement_id = p_procurement_id
     AND status          = 'current';

  -- Create award_recommended stage
  INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, office_id)
  VALUES (p_procurement_id, 'award_recommended', 'current', NOW(), v_proc.office_id);

  UPDATE procurements.procurement_activities
     SET current_stage = 'award_recommended',
         updated_at    = NOW()
   WHERE id = p_procurement_id;
END;
$$;

-- ============================================================
-- approve_award(p_procurement_id, p_notes)
-- HOPE approves the recommended award.
-- Advances stage to 'award_approved'.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.approve_award(
  p_procurement_id UUID,
  p_notes          TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc RECORD;
BEGIN
  IF NOT (procurements.has_permission('award.approve') OR procurements.has_permission('bid.award')) THEN
    RAISE EXCEPTION 'Insufficient permissions to approve award';
  END IF;

  SELECT * INTO v_proc
    FROM procurements.procurement_activities
   WHERE id          = p_procurement_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Procurement activity % not found', p_procurement_id;
  END IF;

  IF v_proc.current_stage <> 'award_recommended' THEN
    RAISE EXCEPTION 'Award can only be approved at award_recommended stage (current: %)', v_proc.current_stage;
  END IF;

  -- Complete current stage
  UPDATE procurements.procurement_stages
     SET status       = 'completed',
         completed_at = NOW(),
         completed_by = auth.uid(),
         notes        = p_notes
   WHERE procurement_id = p_procurement_id
     AND status          = 'current';

  -- Create award_approved stage
  INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, office_id)
  VALUES (p_procurement_id, 'award_approved', 'current', NOW(), v_proc.office_id);

  UPDATE procurements.procurement_activities
     SET current_stage = 'award_approved',
         updated_at    = NOW()
   WHERE id = p_procurement_id;
END;
$$;

-- ============================================================
-- fail_procurement(p_procurement_id, p_reason)
-- Marks procurement as failed (e.g., insufficient bids).
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.fail_procurement(
  p_procurement_id UUID,
  p_reason         TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc RECORD;
BEGIN
  IF NOT (procurements.has_permission('proc.fail') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to fail procurement';
  END IF;

  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 5 THEN
    RAISE EXCEPTION 'A reason of at least 5 characters is required';
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
    RAISE EXCEPTION 'Cannot fail a procurement that is already %', v_proc.status;
  END IF;

  -- Mark current stage as completed
  UPDATE procurements.procurement_stages
     SET status       = 'completed',
         completed_at = NOW(),
         completed_by = auth.uid(),
         notes        = p_reason
   WHERE procurement_id = p_procurement_id
     AND status          = 'current';

  -- Update procurement
  UPDATE procurements.procurement_activities
     SET status         = 'failed',
         failure_reason = p_reason,
         failure_count  = failure_count + 1,
         current_stage  = 'failed',
         updated_at     = NOW()
   WHERE id = p_procurement_id;

  -- Revert PR status back to approved (can create new procurement)
  UPDATE procurements.purchase_requests
     SET procurement_id = NULL,
         status         = 'approved',
         updated_at     = NOW()
   WHERE id = v_proc.purchase_request_id;

  -- Unlink OBR from procurement (keep OBR active)
  UPDATE procurements.obligation_requests
     SET procurement_id = NULL,
         updated_at     = NOW()
   WHERE procurement_id = p_procurement_id
     AND deleted_at     IS NULL;
END;
$$;

-- ============================================================
-- get_procurement_summary(p_fiscal_year_id)
-- Dashboard stats for procurement activities.
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
    'total',          COUNT(*),
    'active',         COUNT(*) FILTER (WHERE status = 'active'),
    'completed',      COUNT(*) FILTER (WHERE status = 'completed'),
    'failed',         COUNT(*) FILTER (WHERE status = 'failed'),
    'svp_count',      COUNT(*) FILTER (WHERE procurement_method = 'svp'),
    'shopping_count', COUNT(*) FILTER (WHERE procurement_method = 'shopping'),
    'total_abc',      COALESCE(SUM(abc_amount), 0)::TEXT,
    'total_awarded',  COALESCE(SUM(contract_amount) FILTER (WHERE status = 'completed'), 0)::TEXT,
    'total_savings',  COALESCE(SUM(savings_amount) FILTER (WHERE status = 'completed'), 0)::TEXT
  )
  INTO v_result
  FROM procurements.procurement_activities
  WHERE division_id    = v_division_id
    AND fiscal_year_id = p_fiscal_year_id
    AND deleted_at     IS NULL;

  RETURN COALESCE(v_result, '{}'::JSONB);
END;
$$;
