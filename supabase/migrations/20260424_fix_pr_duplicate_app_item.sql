DROP FUNCTION IF EXISTS procurements.create_purchase_request(UUID, TEXT,
   UUID, JSONB);                                                          
                                                                          
  CREATE OR REPLACE FUNCTION procurements.create_purchase_request(        
    p_office_id      UUID,                                                
    p_purpose        TEXT,                                                
    p_fiscal_year_id UUID,                                                
    p_items          JSONB               
  )
  RETURNS UUID
  LANGUAGE plpgsql                                                        
  SECURITY DEFINER
  SET search_path = ''                                                    
  AS $$                                   
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
                                                                          
        IF v_app_item.app_status NOT IN ('approved', 'posted') THEN       
          RAISE EXCEPTION 'Line % references an APP item from an APP that 
  is not approved (status: %)',                                           
            v_idx, v_app_item.app_status; 
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
  $$;