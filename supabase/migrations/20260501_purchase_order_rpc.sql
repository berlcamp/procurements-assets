-- Phase 11: Purchase Orders & Delivery — RPC Functions

-- ============================================================
-- generate_po_number(p_office_id, p_fiscal_year_id, p_division_id)
-- Returns: PO-{OFFICE_CODE}-{YEAR}-{NNNN}
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.generate_po_number(
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
     AND counter_type = 'po'
     AND fiscal_year  = v_year
  RETURNING last_value INTO v_next;

  IF NOT FOUND THEN
    INSERT INTO procurements.sequence_counters
      (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
    VALUES
      (p_division_id, p_office_id, 'po', v_year, 1, 'PO')
    RETURNING last_value INTO v_next;
  END IF;

  RETURN 'PO-' || COALESCE(v_office_code, 'DIV') || '-' || v_year || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

-- ============================================================
-- generate_delivery_number(p_office_id, p_fiscal_year_id, p_division_id)
-- Returns: DR-{OFFICE_CODE}-{YEAR}-{NNNN}
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.generate_delivery_number(
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
     AND counter_type = 'dr'
     AND fiscal_year  = v_year
  RETURNING last_value INTO v_next;

  IF NOT FOUND THEN
    INSERT INTO procurements.sequence_counters
      (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
    VALUES
      (p_division_id, p_office_id, 'dr', v_year, 1, 'DR')
    RETURNING last_value INTO v_next;
  END IF;

  RETURN 'DR-' || COALESCE(v_office_code, 'DIV') || '-' || v_year || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

-- ============================================================
-- create_purchase_order(p_procurement_id)
-- Creates a PO from an awarded procurement. Auto-populates line
-- items from the winning bid's bid_items joined with pr_items.
-- Returns: new PO UUID.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.create_purchase_order(
  p_procurement_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_division_id UUID;
  v_proc        RECORD;
  v_po_id       UUID;
  v_po_number   TEXT;
BEGIN
  -- Permission check
  IF NOT (procurements.has_permission('po.create') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to create Purchase Orders';
  END IF;

  v_division_id := procurements.get_user_division_id();

  -- Validate procurement activity
  SELECT * INTO v_proc
    FROM procurements.procurement_activities
   WHERE id          = p_procurement_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Procurement activity % not found', p_procurement_id;
  END IF;

  -- Must have an awarded supplier
  IF v_proc.awarded_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Procurement has not been awarded yet';
  END IF;

  -- Check no existing non-cancelled PO for this procurement
  IF EXISTS (
    SELECT 1 FROM procurements.purchase_orders
    WHERE procurement_id = p_procurement_id
      AND status <> 'cancelled'
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A Purchase Order already exists for this procurement';
  END IF;

  -- Generate PO number
  v_po_number := procurements.generate_po_number(
    v_proc.office_id, v_proc.fiscal_year_id, v_division_id
  );

  -- Insert purchase order
  INSERT INTO procurements.purchase_orders (
    division_id, po_number, procurement_id, supplier_id,
    office_id, fiscal_year_id, total_amount,
    status, created_by
  ) VALUES (
    v_division_id, v_po_number, p_procurement_id, v_proc.awarded_supplier_id,
    v_proc.office_id, v_proc.fiscal_year_id,
    COALESCE(v_proc.contract_amount, v_proc.abc_amount),
    'draft', v_user_id
  )
  RETURNING id INTO v_po_id;

  -- Auto-populate PO items from awarded bid items + PR items
  INSERT INTO procurements.po_items (
    purchase_order_id, pr_item_id, bid_item_id,
    description, unit, quantity, unit_cost, office_id
  )
  SELECT
    v_po_id,
    bi.pr_item_id,
    bi.id,
    pri.description,
    pri.unit,
    pri.quantity,
    bi.offered_unit_cost,
    v_proc.office_id
  FROM procurements.bids b
  JOIN procurements.bid_items bi ON bi.bid_id = b.id
  JOIN procurements.pr_items pri ON pri.id = bi.pr_item_id
  WHERE b.procurement_id = p_procurement_id
    AND b.status          = 'awarded'
    AND b.deleted_at      IS NULL
    AND pri.deleted_at    IS NULL;

  -- Fallback: if no bid items (e.g., direct contracting, emergency),
  -- populate from PR items using estimated costs
  IF NOT EXISTS (
    SELECT 1 FROM procurements.po_items WHERE purchase_order_id = v_po_id
  ) THEN
    INSERT INTO procurements.po_items (
      purchase_order_id, pr_item_id,
      description, unit, quantity, unit_cost, office_id
    )
    SELECT
      v_po_id,
      pri.id,
      pri.description,
      pri.unit,
      pri.quantity,
      pri.estimated_unit_cost,
      v_proc.office_id
    FROM procurements.pr_items pri
    JOIN procurements.purchase_requests pr ON pr.id = pri.purchase_request_id
    WHERE pr.id         = v_proc.purchase_request_id
      AND pri.deleted_at IS NULL;
  END IF;

  -- Recalculate total_amount from actual PO items
  UPDATE procurements.purchase_orders
     SET total_amount = (
       SELECT COALESCE(SUM(quantity * unit_cost), 0)
         FROM procurements.po_items
        WHERE purchase_order_id = v_po_id
     ),
     updated_at = NOW()
   WHERE id = v_po_id;

  RETURN v_po_id;
END;
$$;

-- ============================================================
-- approve_purchase_order(p_po_id, p_remarks)
-- HOPE / Division Chief approves a draft PO.
-- The obligate_on_po_approval trigger handles OBR → obligated.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.approve_purchase_order(
  p_po_id   UUID,
  p_remarks TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_po RECORD;
BEGIN
  IF NOT (procurements.has_permission('po.approve') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to approve Purchase Orders';
  END IF;

  SELECT * INTO v_po
    FROM procurements.purchase_orders
   WHERE id          = p_po_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Order % not found', p_po_id;
  END IF;

  IF v_po.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft POs can be approved (current status: %)', v_po.status;
  END IF;

  UPDATE procurements.purchase_orders
     SET status      = 'approved',
         approved_by = auth.uid(),
         approved_at = NOW(),
         updated_at  = NOW()
   WHERE id = p_po_id;
END;
$$;

-- ============================================================
-- issue_purchase_order(p_po_id)
-- Marks an approved PO as issued (sent to supplier).
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.issue_purchase_order(
  p_po_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_po RECORD;
BEGIN
  IF NOT (procurements.has_permission('po.create') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to issue Purchase Orders';
  END IF;

  SELECT * INTO v_po
    FROM procurements.purchase_orders
   WHERE id          = p_po_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Order % not found', p_po_id;
  END IF;

  IF v_po.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved POs can be issued (current status: %)', v_po.status;
  END IF;

  UPDATE procurements.purchase_orders
     SET status    = 'issued',
         issued_at = NOW(),
         updated_at = NOW()
   WHERE id = p_po_id;
END;
$$;

-- ============================================================
-- record_delivery(p_po_id, p_items, p_delivery_date, p_remarks)
-- Records a delivery against an issued/partially_delivered PO.
-- p_items JSONB: [{ po_item_id, quantity_delivered }]
-- Returns: new delivery UUID.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.record_delivery(
  p_po_id         UUID,
  p_items         JSONB,
  p_delivery_date DATE DEFAULT CURRENT_DATE,
  p_remarks       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_po            RECORD;
  v_delivery_id   UUID;
  v_dr_number     TEXT;
  v_item          JSONB;
  v_po_item       RECORD;
  v_remaining     NUMERIC;
BEGIN
  IF NOT (
    procurements.has_permission('po.create')
    OR procurements.has_permission('delivery.inspect')
    OR procurements.has_permission('proc.manage')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to record deliveries';
  END IF;

  v_division_id := procurements.get_user_division_id();

  -- Validate PO
  SELECT * INTO v_po
    FROM procurements.purchase_orders
   WHERE id          = p_po_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Order % not found', p_po_id;
  END IF;

  IF v_po.status NOT IN ('issued', 'partially_delivered') THEN
    RAISE EXCEPTION 'Deliveries can only be recorded for issued or partially delivered POs (current status: %)', v_po.status;
  END IF;

  -- Items must not be empty
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one delivery item is required';
  END IF;

  -- Validate each item's quantity
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_po_item
      FROM procurements.po_items
     WHERE id = (v_item->>'po_item_id')::UUID
       AND purchase_order_id = p_po_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PO item % not found', v_item->>'po_item_id';
    END IF;

    v_remaining := v_po_item.quantity - v_po_item.delivered_quantity;

    IF (v_item->>'quantity_delivered')::NUMERIC > v_remaining THEN
      RAISE EXCEPTION 'Delivery quantity (%) exceeds remaining quantity (%) for item "%"',
        (v_item->>'quantity_delivered')::NUMERIC,
        v_remaining,
        v_po_item.description;
    END IF;

    IF (v_item->>'quantity_delivered')::NUMERIC <= 0 THEN
      RAISE EXCEPTION 'Delivery quantity must be greater than zero for item "%"',
        v_po_item.description;
    END IF;
  END LOOP;

  -- Generate delivery number
  v_dr_number := procurements.generate_delivery_number(
    v_po.office_id, v_po.fiscal_year_id, v_division_id
  );

  -- Insert delivery record
  INSERT INTO procurements.deliveries (
    division_id, purchase_order_id, delivery_number,
    delivery_date, received_by, inspection_status,
    remarks, office_id, created_by
  ) VALUES (
    v_division_id, p_po_id, v_dr_number,
    p_delivery_date, v_user_id, 'pending',
    p_remarks, v_po.office_id, v_user_id
  )
  RETURNING id INTO v_delivery_id;

  -- Insert delivery items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO procurements.delivery_items (
      delivery_id, po_item_id,
      quantity_delivered, office_id
    ) VALUES (
      v_delivery_id,
      (v_item->>'po_item_id')::UUID,
      (v_item->>'quantity_delivered')::NUMERIC,
      v_po.office_id
    );
  END LOOP;

  -- Triggers handle: delivery_items → po_items.delivered_quantity → PO status

  RETURN v_delivery_id;
END;
$$;

-- ============================================================
-- complete_inspection(p_delivery_id, p_results, p_report_number)
-- IAC records inspection results for a delivery.
-- p_results JSONB: [{ delivery_item_id, quantity_accepted, quantity_rejected, rejection_reason }]
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.complete_inspection(
  p_delivery_id    UUID,
  p_results        JSONB,
  p_report_number  TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_delivery     RECORD;
  v_result       JSONB;
  v_di           RECORD;
  v_total_accepted  NUMERIC := 0;
  v_total_rejected  NUMERIC := 0;
  v_total_delivered NUMERIC := 0;
  v_inspection_status TEXT;
BEGIN
  IF NOT (procurements.has_permission('delivery.inspect') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to complete delivery inspection';
  END IF;

  -- Validate delivery
  SELECT * INTO v_delivery
    FROM procurements.deliveries
   WHERE id          = p_delivery_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery % not found', p_delivery_id;
  END IF;

  IF v_delivery.inspection_status <> 'pending' THEN
    RAISE EXCEPTION 'Inspection already completed (status: %)', v_delivery.inspection_status;
  END IF;

  -- Results must not be empty
  IF jsonb_array_length(p_results) = 0 THEN
    RAISE EXCEPTION 'At least one inspection result is required';
  END IF;

  -- Apply inspection results to each delivery item
  FOR v_result IN SELECT * FROM jsonb_array_elements(p_results)
  LOOP
    -- Validate the delivery item exists
    SELECT * INTO v_di
      FROM procurements.delivery_items
     WHERE id          = (v_result->>'delivery_item_id')::UUID
       AND delivery_id = p_delivery_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Delivery item % not found', v_result->>'delivery_item_id';
    END IF;

    -- Validate accepted + rejected = delivered
    IF (v_result->>'quantity_accepted')::NUMERIC + (v_result->>'quantity_rejected')::NUMERIC
       <> v_di.quantity_delivered THEN
      RAISE EXCEPTION 'Accepted (%) + Rejected (%) must equal delivered (%) for item',
        (v_result->>'quantity_accepted')::NUMERIC,
        (v_result->>'quantity_rejected')::NUMERIC,
        v_di.quantity_delivered;
    END IF;

    -- Update delivery item
    UPDATE procurements.delivery_items
       SET quantity_accepted  = (v_result->>'quantity_accepted')::NUMERIC,
           quantity_rejected  = (v_result->>'quantity_rejected')::NUMERIC,
           rejection_reason   = NULLIF(v_result->>'rejection_reason', ''),
           updated_at         = NOW()
     WHERE id = (v_result->>'delivery_item_id')::UUID;

    v_total_accepted  := v_total_accepted + (v_result->>'quantity_accepted')::NUMERIC;
    v_total_rejected  := v_total_rejected + (v_result->>'quantity_rejected')::NUMERIC;
    v_total_delivered := v_total_delivered + v_di.quantity_delivered;
  END LOOP;

  -- Determine overall inspection status
  IF v_total_rejected = 0 THEN
    v_inspection_status := 'passed';
  ELSIF v_total_accepted = 0 THEN
    v_inspection_status := 'failed';
  ELSE
    v_inspection_status := 'partial_acceptance';
  END IF;

  -- Update delivery record
  UPDATE procurements.deliveries
     SET inspection_status        = v_inspection_status,
         inspection_date          = CURRENT_DATE,
         inspected_by             = auth.uid(),
         inspection_report_number = COALESCE(p_report_number, inspection_report_number),
         updated_at               = NOW()
   WHERE id = p_delivery_id;

  -- The sync_delivery_to_po_items trigger updates po_items.accepted_quantity
  -- The sync_po_delivery_status trigger updates PO status if needed
END;
$$;

-- ============================================================
-- cancel_purchase_order(p_po_id, p_reason)
-- Cancels a PO. Only draft/approved POs can be cancelled.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.cancel_purchase_order(
  p_po_id  UUID,
  p_reason TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_po RECORD;
BEGIN
  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 5 THEN
    RAISE EXCEPTION 'A cancellation reason of at least 5 characters is required';
  END IF;

  IF NOT (procurements.has_permission('po.create') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to cancel Purchase Orders';
  END IF;

  SELECT * INTO v_po
    FROM procurements.purchase_orders
   WHERE id          = p_po_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Order % not found', p_po_id;
  END IF;

  IF v_po.status NOT IN ('draft', 'approved') THEN
    RAISE EXCEPTION 'Cannot cancel a PO in status %. Only draft or approved POs can be cancelled.', v_po.status;
  END IF;

  UPDATE procurements.purchase_orders
     SET status              = 'cancelled',
         cancellation_reason = p_reason,
         cancelled_by        = auth.uid(),
         cancelled_at        = NOW(),
         updated_at          = NOW()
   WHERE id = p_po_id;

  -- If PO was approved, reverse the OBR obligation
  IF v_po.status = 'approved' THEN
    DECLARE
      v_pr_id UUID;
    BEGIN
      SELECT pa.purchase_request_id INTO v_pr_id
        FROM procurements.procurement_activities pa
       WHERE pa.id = v_po.procurement_id;

      IF v_pr_id IS NOT NULL THEN
        UPDATE procurements.obligation_requests
           SET status     = 'certified',
               obligated_at = NULL,
               updated_at = NOW()
         WHERE purchase_request_id = v_pr_id
           AND status = 'obligated'
           AND deleted_at IS NULL;
      END IF;
    END;
  END IF;
END;
$$;
