-- ============================================================
-- Relocate the procurement gate from "the APP is final+approved" to "the lot is
-- released", and add the absolute appropriation gate at contract signing.
--
-- Under RA 12009 (and GPPB Circular 06-2019 before it) a procuring entity may
-- run procurement up to award before the GAA takes effect, on the basis of the
-- indicative APP. What it may NOT do is sign the contract or issue the NTP.
-- DepEd mandates EPA to avoid the year-end rush, so the previous
-- all-or-nothing gate blocked required practice.
--
-- Depends on 20260810: release_app_lot() is what guarantees that a 'released'
-- lot sits under either an approved Final APP or an authorized EPA. This
-- migration only has to ask whether the lot is released.
-- ============================================================

-- ALL-OR-NOTHING. This migration DROPs a function before recreating the
-- gates, so a mid-file failure without a transaction would leave the database
-- with no reachable create_purchase_request at all -- PR creation dead rather
-- than merely mis-gated. Observed for real while developing this file.
-- Follows 20260809_amendment_guards.sql, which wraps for the same reason.
BEGIN;

-- ============================================================
-- 0. Remove the duplicate create_purchase_request overload.
--
-- The tree grew TWO four-argument versions with the SAME parameter names in a
-- different order:
--   (p_office_id, p_fiscal_year_id, p_purpose, p_items)  20260413  <- orphan
--   (p_office_id, p_purpose, p_fiscal_year_id, p_items)  20260424  <- the app's
-- 20260424 dropped only its own signature before creating, so CREATE OR REPLACE
-- added a second function instead of replacing the first.
--
-- This is not cosmetic. PostgREST calls RPCs with NAMED arguments, and with
-- identical name sets Postgres cannot resolve the call:
--   ERROR: function procurements.create_purchase_request(p_office_id => ...,
--          p_purpose => ..., p_fiscal_year_id => ..., p_items => jsonb)
--          is not unique
-- src/lib/actions/procurement.ts:600 calls it exactly that way, so PR creation
-- is unreachable while both exist. Independently of that, leaving the orphan
-- would leave a SECOND, still-ungated path into purchase requests after this
-- migration re-gates the other one.
--
-- Dropped with the explicit signature so the app's version cannot be hit by
-- mistake. Authorized by the user 2026-07-31.
-- ============================================================

DROP FUNCTION IF EXISTS procurements.create_purchase_request(UUID, UUID, TEXT, JSONB);

-- ============================================================
-- 1. appropriation_exists() -- is there legally enacted money for this FY?
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.appropriation_exists(
  p_fiscal_year_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM procurements.budget_ceilings
     WHERE fiscal_year_id   = p_fiscal_year_id
       AND is_authoritative = true
       AND deleted_at       IS NULL
       AND stage IN ('gaa','final')
  );
$$;

COMMENT ON FUNCTION procurements.appropriation_exists(UUID) IS
  'True once a GAA or release-stage ceiling is recorded for the fiscal year. Hard gate for contract signing: EPA may bid and award before this is true, but may never sign.';

-- ============================================================
-- 2. create_purchase_request -- gate on lot release.
--
-- Body is the LIVE definition, taken from pg_get_functiondef (the 20260424
-- signature the application calls), with ONLY the APP-status gate replaced.
-- Note it carries SET search_path = '', so everything inside is fully
-- schema-qualified -- including the code added here.
-- v_app_item is selected as `ai.*`, so lot_id is already in scope; no change to
-- the SELECT list was needed.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.create_purchase_request(p_office_id uuid, p_purpose text, p_fiscal_year_id uuid, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$                                   
  DECLARE                                
    v_division_id    UUID;
    v_user_office    UUID;
    v_pr_id          UUID;                                                
    v_pr_number      TEXT;
    v_total_cost     NUMERIC(15,2) := 0;                                  
    v_item           RECORD;                                              
    v_idx            INT := 0;                                            
    v_app_item       RECORD;                                              
    v_first_app_item RECORD;                                              
    v_first_alloc    RECORD;              
    v_fund_src_id    UUID := NULL;                                        
    v_mode           TEXT;
    v_unified_mode   TEXT;                                                
    v_ceiling        NUMERIC(15,2);                                       
    v_app_item_id    UUID;               
    v_row_total      NUMERIC;                                             
    v_seen_app_items UUID[] := ARRAY[]::UUID[];                           
    v_app_item_totals JSONB := '{}'::JSONB;
    v_cumulative     NUMERIC;                                             
    v_budget_check   RECORD;                                              
    v_check_id       UUID;                                                
  BEGIN                                                                   
    v_division_id := procurements.get_user_division_id();
    SELECT office_id INTO v_user_office FROM procurements.user_profiles   
  WHERE id = auth.uid();                                                  
                                         
    IF v_division_id IS NULL THEN                                         
      RAISE EXCEPTION 'User has no division assigned';
    END IF;                                                               
                                          
    IF jsonb_array_length(p_items) = 0 THEN                               
      RAISE EXCEPTION 'At least one line item is required';
    END IF;                                                               
                                          
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
    LOOP
      v_idx := v_idx + 1;                                                 
      v_app_item_id := NULLIF((v_item.value)->>'app_item_id', '')::UUID;
                                                                          
      IF v_app_item_id IS NULL THEN
        RAISE EXCEPTION 'Line % is missing app_item_id', v_idx;           
      END IF;                                                             
                                         
      v_row_total := ((v_item.value)->>'quantity')::NUMERIC *             
  ((v_item.value)->>'estimated_unit_cost')::NUMERIC;
                                                                          
      v_cumulative :=                                                     
  COALESCE((v_app_item_totals->>v_app_item_id::TEXT)::NUMERIC, 0) +
  v_row_total;                                                            
      v_app_item_totals := jsonb_set(v_app_item_totals,
  ARRAY[v_app_item_id::TEXT], to_jsonb(v_cumulative));                    
   
      IF NOT (v_app_item_id = ANY(v_seen_app_items)) THEN                 
        v_seen_app_items := array_append(v_seen_app_items, v_app_item_id);
                                                                          
        SELECT                            
          ai.*,                                                           
          a.status            AS app_status,
          a.indicative_final  AS app_indicative_final                     
        INTO v_app_item
        FROM procurements.app_items ai                                    
        JOIN procurements.apps a ON a.id = ai.app_id                      
        WHERE ai.id          = v_app_item_id
          AND ai.deleted_at  IS NULL                                      
          AND a.deleted_at   IS NULL                                      
          AND a.division_id  = v_division_id;
                                                                          
        IF NOT FOUND THEN                 
          RAISE EXCEPTION 'APP item % (line %) not found or not           
  accessible', v_app_item_id, v_idx;                                      
        END IF;                          
                                                                          
        -- Two-gate model (20260810/20260811). The gate is the LOT being
        -- released, not the whole APP being approved. release_app_lot() already
        -- guarantees either an approved Final APP or an authorized EPA, so this
        -- is the correct place to ask -- and it is what makes Early Procurement
        -- Activity possible at all.
        --
        -- NOTE this function runs with SET search_path = '', so every reference
        -- here must stay fully schema-qualified.
        IF v_app_item.lot_id IS NULL THEN
          RAISE EXCEPTION
            'Line % references an APP item that is not assigned to a lot yet.', v_idx;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM procurements.app_lots
           WHERE id = v_app_item.lot_id
             AND deleted_at IS NULL
             AND status IN ('released','in_procurement')
        ) THEN
          RAISE EXCEPTION
            'Line % references an APP item whose lot has not been released for procurement. '
            'The BAC must release the lot first (an approved Final APP, or an authorized EPA).',
            v_idx;
        END IF;
                                          
        IF NOT procurements.has_permission('ppmp.view_all') THEN          
          IF v_app_item.source_office_id IS NOT NULL
             AND v_app_item.source_office_id <> v_user_office THEN        
            RAISE EXCEPTION 'Line % references an APP item from another   
  office.', v_idx;                       
          END IF;                                                         
        END IF;                           
                                         
        IF EXISTS (
          SELECT 1
            FROM procurements.pr_items pi                                 
            JOIN procurements.purchase_requests pr ON pr.id =
  pi.purchase_request_id                                                  
           WHERE pi.app_item_id = v_app_item_id
             AND pi.deleted_at  IS NULL                                   
             AND pr.deleted_at  IS NULL
             AND pr.status      <> 'cancelled'                            
        ) THEN                                                            
          RAISE EXCEPTION 'APP item on line % is already in another active
   Purchase Request', v_idx;                                              
        END IF;                           
                                                                          
        v_mode := LOWER(TRIM(COALESCE(v_app_item.procurement_mode, ''))); 
        v_mode := CASE                   
          WHEN v_mode IN ('small value procurement', 'svp') THEN 'svp'    
          WHEN v_mode IN ('public bidding', 'competitive bidding',        
  'bidding') THEN 'competitive_bidding'                                   
          WHEN v_mode = 'shopping' THEN 'shopping'                        
          ELSE v_mode                                                     
        END;                              
                                                                          
        IF v_mode = '' THEN
          RAISE EXCEPTION 'APP item on line % has no procurement_mode     
  set', v_idx;                            
        END IF;                          

        IF v_unified_mode IS NULL THEN                                    
          v_unified_mode := v_mode;
          v_first_app_item := v_app_item;                                 
        ELSIF v_unified_mode <> v_mode THEN
          RAISE EXCEPTION 'All items must share the same procurement mode 
  (line 1 is %, line % is %)',                                            
            v_unified_mode, v_idx, v_mode;
        END IF;                                                           
      END IF;                             
                                         
      v_total_cost := v_total_cost + v_row_total;                         
    END LOOP;
                                                                          
    FOR v_budget_check IN SELECT key, value FROM                          
  jsonb_each_text(v_app_item_totals)     
    LOOP                                                                  
      v_check_id   := (v_budget_check.key)::UUID;
      v_cumulative := (v_budget_check.value)::NUMERIC;                    
  
      SELECT ai.estimated_budget::NUMERIC AS budget                       
        INTO v_row_total                  
        FROM procurements.app_items ai                                    
       WHERE ai.id = v_check_id;          
                                         
      IF v_cumulative > v_row_total THEN                                  
        RAISE EXCEPTION 'Total for APP item % (₱%) exceeds the APP item 
  budget (₱%)',                                                           
          v_check_id, v_cumulative, v_row_total;
      END IF;                                                             
    END LOOP;                             
                                         
    SELECT ceiling_amount INTO v_ceiling                                  
      FROM procurements.procurement_method_ceilings
     WHERE procurement_mode = v_unified_mode;                             
                                                                          
    IF v_ceiling IS NOT NULL AND v_total_cost > v_ceiling THEN            
      RAISE EXCEPTION 'Bundled total (₱%) exceeds the ABC ceiling for %   
  (₱%).',                                                                 
        v_total_cost, v_unified_mode, v_ceiling;
    END IF;                                                               
                                          
    IF v_first_app_item.budget_allocation_id IS NOT NULL THEN             
      SELECT ba.fund_source_id, ba.adjusted_amount, ba.obligated_amount
        INTO v_first_alloc                                                
        FROM procurements.budget_allocations ba
       WHERE ba.id = v_first_app_item.budget_allocation_id                
         AND ba.deleted_at IS NULL;       
                                                                          
      IF FOUND THEN                       
        v_fund_src_id := v_first_alloc.fund_source_id;
        IF (v_first_alloc.adjusted_amount::NUMERIC -                      
  v_first_alloc.obligated_amount::NUMERIC) < v_total_cost THEN            
          RAISE EXCEPTION 'Insufficient budget. Available: ₱%, Requested: 
  ₱%',                                                                    
            (v_first_alloc.adjusted_amount::NUMERIC -
  v_first_alloc.obligated_amount::NUMERIC),                               
            v_total_cost;                 
        END IF;                                                           
      END IF;                             
    END IF;                              

    v_pr_number := procurements.generate_pr_number(p_office_id,           
  p_fiscal_year_id, v_division_id);
                                                                          
    INSERT INTO procurements.purchase_requests (                          
      division_id, pr_number, office_id, fiscal_year_id, purpose,
      requested_by, requested_at,                                         
      fund_source_id, budget_allocation_id,                               
      procurement_mode, abc_ceiling,     
      total_estimated_cost, status, created_by                            
    ) VALUES (                            
      v_division_id, v_pr_number, p_office_id, p_fiscal_year_id,          
  p_purpose,                                                              
      auth.uid(), NOW(),                 
      v_fund_src_id, v_first_app_item.budget_allocation_id,               
      v_unified_mode, v_ceiling,          
      v_total_cost, 'draft', auth.uid()                                   
    )
    RETURNING id INTO v_pr_id;                                            
                                          
    v_idx := 0;                          
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS value
    LOOP                                                                  
      v_idx := v_idx + 1;
      v_app_item_id := ((v_item.value)->>'app_item_id')::UUID;            
                                                                          
      INSERT INTO procurements.pr_items (
        purchase_request_id, item_number, description, unit, quantity,    
        estimated_unit_cost,              
        ppmp_item_id, app_item_id, remarks, office_id
      ) VALUES (
        v_pr_id,
        COALESCE(((v_item.value)->>'item_number')::INT, v_idx),           
        (v_item.value)->>'description',
        (v_item.value)->>'unit',                                          
        ((v_item.value)->>'quantity')::NUMERIC,
        ((v_item.value)->>'estimated_unit_cost')::NUMERIC,                
        (SELECT source_ppmp_lot_id FROM procurements.app_items WHERE id =
  v_app_item_id),                                                         
        v_app_item_id,                    
        NULLIF((v_item.value)->>'remarks', ''),                           
        p_office_id
      );                                                                  
    END LOOP;                             
                                         
    RETURN v_pr_id;
  END;
  $function$;

-- ============================================================
-- 3. add_pr_item -- the same gate, so the two ways of putting a line on a PR
--    agree. Leaving this one on the old rule would make it the stricter path
--    and would silently block EPA lines added after the PR was created.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.add_pr_item(p_pr_id uuid, p_app_item_id uuid, p_description text, p_unit text, p_quantity numeric, p_estimated_unit_cost numeric, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'procurements', 'public'
AS $function$
DECLARE
  v_pr            RECORD;
  v_division_id   UUID;
  v_app_item      RECORD;
  v_row_total     NUMERIC;
  v_new_total     NUMERIC;
  v_next_item_no  INT;
  v_pi_id         UUID;
BEGIN
  v_division_id := procurements.get_user_division_id();

  SELECT * INTO v_pr FROM procurements.purchase_requests WHERE id = p_pr_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Request not found';
  END IF;
  IF v_pr.status <> 'draft' THEN
    RAISE EXCEPTION 'Items can only be added while the PR is in draft (current: %)', v_pr.status;
  END IF;
  IF v_pr.division_id <> v_division_id THEN
    RAISE EXCEPTION 'Cannot modify a PR outside your division';
  END IF;

  SELECT ai.* INTO v_app_item
    FROM procurements.app_items ai
    JOIN procurements.apps a ON a.id = ai.app_id
   WHERE ai.id = p_app_item_id
     AND ai.deleted_at IS NULL
     AND a.deleted_at  IS NULL
     AND a.division_id = v_division_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP item not found or not accessible';
  END IF;

  -- Two-gate model (20260811): gate on the LOT being released rather than on
  -- the whole APP being approved, matching create_purchase_request. Without
  -- this, add_pr_item would remain the pre-EPA gate and would silently be the
  -- stricter of the two paths into the same purchase request.
  IF v_app_item.lot_id IS NULL THEN
    RAISE EXCEPTION 'That APP item is not assigned to a lot yet.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM procurements.app_lots
     WHERE id = v_app_item.lot_id
       AND deleted_at IS NULL
       AND status IN ('released','in_procurement')
  ) THEN
    RAISE EXCEPTION
      'That APP item''s lot has not been released for procurement. '
      'The BAC must release the lot first (an approved Final APP, or an authorized EPA).';
  END IF;

  v_row_total := p_quantity * p_estimated_unit_cost;
  IF v_row_total > v_app_item.estimated_budget::NUMERIC THEN
    RAISE EXCEPTION 'Line total (₱%) exceeds APP item budget (₱%)', v_row_total, v_app_item.estimated_budget;
  END IF;

  -- Recompute new total and re-check ceiling
  SELECT COALESCE(SUM(estimated_total_cost::NUMERIC), 0) + v_row_total
    INTO v_new_total
    FROM procurements.pr_items
   WHERE purchase_request_id = p_pr_id AND deleted_at IS NULL;

  IF v_pr.abc_ceiling IS NOT NULL AND v_new_total > v_pr.abc_ceiling THEN
    RAISE EXCEPTION 'Adding this line would exceed the ABC ceiling for % (₱%). New total: ₱%',
      v_pr.procurement_mode, v_pr.abc_ceiling, v_new_total;
  END IF;

  SELECT COALESCE(MAX(item_number), 0) + 1 INTO v_next_item_no
    FROM procurements.pr_items
   WHERE purchase_request_id = p_pr_id;

  INSERT INTO procurements.pr_items (
    purchase_request_id, item_number, description, unit, quantity,
    estimated_unit_cost,
    ppmp_item_id, app_item_id, remarks, office_id
  ) VALUES (
    p_pr_id, v_next_item_no, p_description, p_unit, p_quantity,
    p_estimated_unit_cost,
    v_app_item.source_ppmp_lot_id, p_app_item_id, NULLIF(p_remarks, ''),
    v_pr.office_id
  )
  RETURNING id INTO v_pi_id;

  -- Recalculate PR header total
  UPDATE procurements.purchase_requests
     SET total_estimated_cost = v_new_total,
         updated_at           = NOW()
   WHERE id = p_pr_id;

  RETURN v_pi_id;
END;
$function$;

-- ============================================================
-- 4. advance_procurement_stage -- the absolute contract-signing gate.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.advance_procurement_stage(p_procurement_id uuid, p_next_stage text, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'procurements', 'platform', 'auth', 'public'
AS $function$
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
  -- ABSOLUTE GATE: no contract may be signed against money that does not
  -- legally exist, EPA or not.
  --
  -- Keyed on p_next_stage, NOT on procurement_method: 'contract_signing'
  -- appears in the stage list of four different methods above, so a
  -- method-specific check would leave three ways round it.
  -- procurement_activities.fiscal_year_id is a real column (verified), so no
  -- resolution through purchase_requests is needed.
  -- ----------------------------------------------------------------
  IF p_next_stage = 'contract_signing'
     AND NOT procurements.appropriation_exists(v_proc.fiscal_year_id) THEN
    RAISE EXCEPTION
      'Cannot advance to contract signing: no GAA or release-stage budget ceiling '
      'is recorded for this fiscal year. Early Procurement Activity permits bidding '
      'and award before the appropriation exists, but never contract signing. '
      'Record the GAA ceiling first.';
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
$function$;

COMMIT;
