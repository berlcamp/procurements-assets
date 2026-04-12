-- Phase 13: Asset Management (Property) — RPC Functions
-- Property number generation, asset registration (from delivery + manual),
-- transfer, depreciation (single + batch), disposal (initiate + complete)

-- ============================================================
-- generate_property_number(p_office_id, p_division_id, p_asset_type)
-- Returns: {OFFICE_CODE}-{YEAR}-{SE|PPE}-{NNNN}
-- Uses sequence_counters with counter_type 'property_se' or 'property_ppe'
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.generate_property_number(
  p_office_id   UUID,
  p_division_id UUID,
  p_asset_type  TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_office_code  TEXT;
  v_year         INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_next         INTEGER;
  v_counter_type TEXT;
  v_prefix       TEXT;
BEGIN
  SELECT code INTO v_office_code
    FROM procurements.offices
   WHERE id = p_office_id;

  -- Determine counter type and prefix from asset type
  IF p_asset_type = 'ppe' THEN
    v_counter_type := 'property_ppe';
    v_prefix       := 'PPE';
  ELSIF p_asset_type = 'semi_expendable' THEN
    v_counter_type := 'property_se';
    v_prefix       := 'SE';
  ELSE
    RAISE EXCEPTION 'Invalid asset type: %', p_asset_type;
  END IF;

  -- Increment or create sequence counter
  UPDATE procurements.sequence_counters
     SET last_value = last_value + 1
   WHERE division_id  = p_division_id
     AND office_id    = p_office_id
     AND counter_type = v_counter_type
     AND fiscal_year  = v_year
  RETURNING last_value INTO v_next;

  IF NOT FOUND THEN
    INSERT INTO procurements.sequence_counters
      (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
    VALUES
      (p_division_id, p_office_id, v_counter_type, v_year, 1, v_prefix)
    RETURNING last_value INTO v_next;
  END IF;

  RETURN COALESCE(v_office_code, 'DIV') || '-' || v_year || '-' || v_prefix || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.generate_property_number(UUID, UUID, TEXT) TO authenticated;

-- ============================================================
-- generate_par_ics_number(p_office_id, p_division_id, p_doc_type)
-- Returns: PAR-{OFFICE_CODE}-{YEAR}-{NNNN} or ICS-{OFFICE_CODE}-{YEAR}-{NNNN}
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.generate_par_ics_number(
  p_office_id   UUID,
  p_division_id UUID,
  p_doc_type    TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_office_code  TEXT;
  v_year         INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_next         INTEGER;
  v_prefix       TEXT;
BEGIN
  SELECT code INTO v_office_code
    FROM procurements.offices
   WHERE id = p_office_id;

  IF p_doc_type = 'par' THEN
    v_prefix := 'PAR';
  ELSIF p_doc_type = 'ics' THEN
    v_prefix := 'ICS';
  ELSE
    RAISE EXCEPTION 'Invalid document type: %. Must be par or ics.', p_doc_type;
  END IF;

  UPDATE procurements.sequence_counters
     SET last_value = last_value + 1
   WHERE division_id  = p_division_id
     AND office_id    = p_office_id
     AND counter_type = p_doc_type
     AND fiscal_year  = v_year
  RETURNING last_value INTO v_next;

  IF NOT FOUND THEN
    INSERT INTO procurements.sequence_counters
      (division_id, office_id, counter_type, fiscal_year, last_value, prefix)
    VALUES
      (p_division_id, p_office_id, p_doc_type, v_year, 1, v_prefix)
    RETURNING last_value INTO v_next;
  END IF;

  RETURN v_prefix || '-' || COALESCE(v_office_code, 'DIV') || '-' || v_year || '-' || lpad(v_next::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.generate_par_ics_number(UUID, UUID, TEXT) TO authenticated;

-- ============================================================
-- register_asset_from_delivery(p_delivery_item_id, p_details)
-- Creates an asset from an accepted delivery item.
-- p_details JSONB: { brand_model, serial_number, location,
--   custodian_id, residual_value, useful_life_years }
-- Returns: the new asset UUID.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.register_asset_from_delivery(
  p_delivery_item_id UUID,
  p_details          JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id          UUID := auth.uid();
  v_division_id      UUID;
  v_accessible       UUID[];
  v_di               RECORD;
  v_delivery         RECORD;
  v_po               RECORD;
  v_po_item          RECORD;
  v_catalog          RECORD;
  v_asset_id         UUID;
  v_property_number  TEXT;
  v_office_id        UUID;
  v_registered_count INTEGER;
  v_accepted_qty     INTEGER;
  v_doc_type         TEXT;
  v_doc_number       TEXT;
  v_custodian_id     UUID;
  v_useful_life      INTEGER;
  v_residual         NUMERIC(14,2);
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('asset.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to register assets';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  -- Validate delivery item
  SELECT * INTO v_di
    FROM procurements.delivery_items
   WHERE id = p_delivery_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery item % not found', p_delivery_item_id;
  END IF;

  IF v_di.quantity_accepted <= 0 THEN
    RAISE EXCEPTION 'Delivery item has no accepted quantity';
  END IF;

  -- Validate delivery
  SELECT * INTO v_delivery
    FROM procurements.deliveries
   WHERE id          = v_di.delivery_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery not found or not in your division';
  END IF;

  IF v_delivery.inspection_status NOT IN ('passed', 'partial_acceptance') THEN
    RAISE EXCEPTION 'Delivery inspection must be passed or partial_acceptance';
  END IF;

  -- Determine office
  v_office_id := COALESCE(v_di.office_id, v_delivery.office_id);

  -- Office scope check
  IF NOT (v_office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to register assets for this office';
  END IF;

  -- Get PO and PO item for context (description, unit_cost)
  SELECT * INTO v_po
    FROM procurements.purchase_orders
   WHERE id = v_delivery.purchase_order_id;

  SELECT * INTO v_po_item
    FROM procurements.po_items
   WHERE id = v_di.po_item_id;

  -- Find the item_catalog entry (should exist from stock-in)
  SELECT * INTO v_catalog
    FROM procurements.item_catalog
   WHERE division_id = v_division_id
     AND name        = v_po_item.description
     AND unit        = v_po_item.unit
     AND deleted_at  IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item catalog entry not found for "%". Run stock-in first.', v_po_item.description;
  END IF;

  -- Validate category is semi-expendable or PPE
  IF v_catalog.category NOT IN ('semi_expendable', 'ppe') THEN
    RAISE EXCEPTION 'Item "%" is categorized as %. Only semi_expendable and ppe items can be registered as assets.',
      v_catalog.name, v_catalog.category;
  END IF;

  -- Over-registration guard: count already-registered assets for this delivery_item
  SELECT COUNT(*) INTO v_registered_count
    FROM procurements.assets
   WHERE source_delivery_item_id = p_delivery_item_id
     AND deleted_at IS NULL;

  v_accepted_qty := FLOOR(v_di.quantity_accepted)::INTEGER;

  IF v_registered_count >= v_accepted_qty THEN
    RAISE EXCEPTION 'All % accepted items from this delivery item have already been registered as assets',
      v_accepted_qty;
  END IF;

  -- Extract optional details from JSONB
  v_custodian_id := (p_details->>'custodian_id')::UUID;
  v_useful_life  := COALESCE((p_details->>'useful_life_years')::INTEGER, v_catalog.useful_life_years);
  v_residual     := COALESCE((p_details->>'residual_value')::NUMERIC, 0);

  -- Generate property number
  v_property_number := procurements.generate_property_number(
    v_office_id, v_division_id, v_catalog.category
  );

  -- Create asset
  INSERT INTO procurements.assets (
    division_id, property_number, item_catalog_id, office_id,
    description, brand_model, serial_number,
    acquisition_date, acquisition_cost,
    source_po_id, source_delivery_id, source_delivery_item_id,
    asset_type, condition_status,
    current_custodian_id, location,
    useful_life_years, residual_value,
    accumulated_depreciation, book_value,
    status, created_by
  ) VALUES (
    v_division_id,
    v_property_number,
    v_catalog.id,
    v_office_id,
    v_po_item.description,
    p_details->>'brand_model',
    p_details->>'serial_number',
    COALESCE((p_details->>'acquisition_date')::DATE, v_delivery.delivery_date),
    v_po_item.unit_cost,
    v_po.id,
    v_delivery.id,
    p_delivery_item_id,
    v_catalog.category,
    'serviceable',
    v_custodian_id,
    p_details->>'location',
    v_useful_life,
    v_residual,
    0,
    v_po_item.unit_cost,  -- book_value = acquisition_cost initially
    'active',
    v_user_id
  )
  RETURNING id INTO v_asset_id;

  -- If custodian provided, create initial assignment (PAR for PPE, ICS for semi-expendable)
  IF v_custodian_id IS NOT NULL THEN
    v_doc_type := CASE v_catalog.category
      WHEN 'ppe' THEN 'par'
      WHEN 'semi_expendable' THEN 'ics'
    END;

    v_doc_number := procurements.generate_par_ics_number(
      v_office_id, v_division_id, v_doc_type
    );

    INSERT INTO procurements.asset_assignments (
      division_id, asset_id, custodian_id, office_id,
      document_type, document_number,
      assigned_date, assigned_by, is_current
    ) VALUES (
      v_division_id, v_asset_id, v_custodian_id, v_office_id,
      v_doc_type, v_doc_number,
      CURRENT_DATE, v_user_id, true
    );
    -- Trigger updates assets.current_custodian_id
  END IF;

  RETURN v_asset_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.register_asset_from_delivery(UUID, JSONB) TO authenticated;

-- ============================================================
-- register_asset_manual(p_details)
-- Registers a pre-existing asset not from deliveries.
-- p_details JSONB: { item_catalog_id, office_id, description,
--   brand_model, serial_number, acquisition_date, acquisition_cost,
--   asset_type, location, custodian_id, useful_life_years, residual_value }
-- Returns: the new asset UUID.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.register_asset_manual(
  p_details JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id          UUID := auth.uid();
  v_division_id      UUID;
  v_accessible       UUID[];
  v_asset_id         UUID;
  v_property_number  TEXT;
  v_office_id        UUID;
  v_asset_type       TEXT;
  v_acquisition_cost NUMERIC(14,2);
  v_residual         NUMERIC(14,2);
  v_custodian_id     UUID;
  v_doc_type         TEXT;
  v_doc_number       TEXT;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('asset.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to register assets';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  v_office_id        := (p_details->>'office_id')::UUID;
  v_asset_type       := p_details->>'asset_type';
  v_acquisition_cost := (p_details->>'acquisition_cost')::NUMERIC;
  v_residual         := COALESCE((p_details->>'residual_value')::NUMERIC, 0);
  v_custodian_id     := (p_details->>'custodian_id')::UUID;

  -- Validate required fields
  IF v_office_id IS NULL THEN
    RAISE EXCEPTION 'office_id is required';
  END IF;
  IF v_asset_type IS NULL OR v_asset_type NOT IN ('semi_expendable', 'ppe') THEN
    RAISE EXCEPTION 'asset_type must be semi_expendable or ppe';
  END IF;
  IF v_acquisition_cost IS NULL OR v_acquisition_cost <= 0 THEN
    RAISE EXCEPTION 'acquisition_cost must be a positive number';
  END IF;

  -- Office scope check
  IF NOT (v_office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to register assets for this office';
  END IF;

  -- Validate item catalog
  IF NOT EXISTS (
    SELECT 1 FROM procurements.item_catalog
    WHERE id          = (p_details->>'item_catalog_id')::UUID
      AND division_id = v_division_id
      AND deleted_at  IS NULL
      AND is_active   = true
  ) THEN
    RAISE EXCEPTION 'Item catalog entry not found or inactive';
  END IF;

  -- Generate property number
  v_property_number := procurements.generate_property_number(
    v_office_id, v_division_id, v_asset_type
  );

  -- Create asset
  INSERT INTO procurements.assets (
    division_id, property_number, item_catalog_id, office_id,
    description, brand_model, serial_number,
    acquisition_date, acquisition_cost,
    asset_type, condition_status,
    current_custodian_id, location,
    useful_life_years, residual_value,
    accumulated_depreciation, book_value,
    status, created_by
  ) VALUES (
    v_division_id,
    v_property_number,
    (p_details->>'item_catalog_id')::UUID,
    v_office_id,
    p_details->>'description',
    p_details->>'brand_model',
    p_details->>'serial_number',
    COALESCE((p_details->>'acquisition_date')::DATE, CURRENT_DATE),
    v_acquisition_cost,
    v_asset_type,
    'serviceable',
    v_custodian_id,
    p_details->>'location',
    (p_details->>'useful_life_years')::INTEGER,
    v_residual,
    0,
    v_acquisition_cost,  -- book_value = acquisition_cost initially
    'active',
    v_user_id
  )
  RETURNING id INTO v_asset_id;

  -- If custodian provided, create initial assignment
  IF v_custodian_id IS NOT NULL THEN
    v_doc_type := CASE v_asset_type
      WHEN 'ppe' THEN 'par'
      WHEN 'semi_expendable' THEN 'ics'
    END;

    v_doc_number := procurements.generate_par_ics_number(
      v_office_id, v_division_id, v_doc_type
    );

    INSERT INTO procurements.asset_assignments (
      division_id, asset_id, custodian_id, office_id,
      document_type, document_number,
      assigned_date, assigned_by, is_current
    ) VALUES (
      v_division_id, v_asset_id, v_custodian_id, v_office_id,
      v_doc_type, v_doc_number,
      CURRENT_DATE, v_user_id, true
    );
  END IF;

  RETURN v_asset_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.register_asset_manual(JSONB) TO authenticated;

-- ============================================================
-- transfer_asset(p_asset_id, p_new_custodian_id, p_new_office_id, p_remarks)
-- Transfers custody of an asset to a new custodian.
-- Generates new PAR/ICS document. Optionally moves to new office.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.transfer_asset(
  p_asset_id         UUID,
  p_new_custodian_id UUID,
  p_new_office_id    UUID DEFAULT NULL,
  p_remarks          TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_division_id  UUID;
  v_accessible   UUID[];
  v_asset        RECORD;
  v_target_office UUID;
  v_doc_type     TEXT;
  v_doc_number   TEXT;
  v_assignment_id UUID;
BEGIN
  -- Permission check
  IF NOT (procurements.has_permission('asset.assign') OR procurements.has_permission('asset.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to transfer assets';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  -- Validate asset
  SELECT * INTO v_asset
    FROM procurements.assets
   WHERE id          = p_asset_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF v_asset.status NOT IN ('active', 'transferred') THEN
    RAISE EXCEPTION 'Cannot transfer asset with status %', v_asset.status;
  END IF;

  -- Office scope check on current office
  IF NOT (v_asset.office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to transfer assets from this office';
  END IF;

  -- Determine target office
  v_target_office := COALESCE(p_new_office_id, v_asset.office_id);

  -- If transferring to a new office, validate access to target
  IF p_new_office_id IS NOT NULL AND p_new_office_id <> v_asset.office_id THEN
    IF NOT (p_new_office_id = ANY(v_accessible)) THEN
      RAISE EXCEPTION 'You do not have access to transfer assets to this office';
    END IF;

    -- Update asset office
    UPDATE procurements.assets
       SET office_id  = p_new_office_id,
           updated_at = NOW()
     WHERE id = p_asset_id;
  END IF;

  -- Generate new PAR/ICS document
  v_doc_type := CASE v_asset.asset_type
    WHEN 'ppe' THEN 'par'
    WHEN 'semi_expendable' THEN 'ics'
  END;

  v_doc_number := procurements.generate_par_ics_number(
    v_target_office, v_division_id, v_doc_type
  );

  -- Create new assignment (trigger closes previous, updates custodian)
  INSERT INTO procurements.asset_assignments (
    division_id, asset_id, custodian_id, office_id,
    document_type, document_number,
    assigned_date, remarks, assigned_by, is_current
  ) VALUES (
    v_division_id, p_asset_id, p_new_custodian_id, v_target_office,
    v_doc_type, v_doc_number,
    CURRENT_DATE, p_remarks, v_user_id, true
  )
  RETURNING id INTO v_assignment_id;

  RETURN v_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.transfer_asset(UUID, UUID, UUID, TEXT) TO authenticated;

-- ============================================================
-- calculate_depreciation(p_asset_id)
-- Computes one month of straight-line depreciation for a single asset.
-- Formula: monthly = (acquisition_cost - residual_value) / (useful_life_years * 12)
-- Stops when book_value <= residual_value.
-- Returns: the depreciation_amount (0 if fully depreciated or skipped).
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.calculate_depreciation(
  p_asset_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_asset         RECORD;
  v_monthly_dep   NUMERIC(14,2);
  v_new_accum     NUMERIC(14,2);
  v_new_bv        NUMERIC(14,2);
  v_max_dep       NUMERIC(14,2);
  v_year          INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_month         INTEGER := EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('asset.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to calculate depreciation';
  END IF;

  v_division_id := procurements.get_user_division_id();

  -- Validate asset
  SELECT * INTO v_asset
    FROM procurements.assets
   WHERE id          = p_asset_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  -- Only depreciate active PPE with useful_life_years
  IF v_asset.asset_type <> 'ppe' THEN
    RAISE EXCEPTION 'Only PPE assets can be depreciated. This asset is %', v_asset.asset_type;
  END IF;

  IF v_asset.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot depreciate asset with status %', v_asset.status;
  END IF;

  IF v_asset.useful_life_years IS NULL OR v_asset.useful_life_years <= 0 THEN
    RAISE EXCEPTION 'Asset has no useful life set';
  END IF;

  -- Check if already fully depreciated
  IF v_asset.book_value <= v_asset.residual_value THEN
    RETURN 0;
  END IF;

  -- Check if already depreciated for this period
  IF EXISTS (
    SELECT 1 FROM procurements.depreciation_records
    WHERE asset_id     = p_asset_id
      AND period_year  = v_year
      AND period_month = v_month
  ) THEN
    RAISE EXCEPTION 'Depreciation for % / % has already been recorded for this asset',
      v_year, v_month;
  END IF;

  -- Straight-line depreciation
  v_monthly_dep := ROUND(
    (v_asset.acquisition_cost - v_asset.residual_value) / (v_asset.useful_life_years * 12),
    2
  );

  -- Cap depreciation so book_value doesn't go below residual_value
  v_max_dep := v_asset.book_value - v_asset.residual_value;
  IF v_monthly_dep > v_max_dep THEN
    v_monthly_dep := v_max_dep;
  END IF;

  v_new_accum := v_asset.accumulated_depreciation + v_monthly_dep;
  v_new_bv    := v_asset.acquisition_cost - v_new_accum;

  -- Insert depreciation record (trigger updates asset)
  INSERT INTO procurements.depreciation_records (
    asset_id, period_year, period_month,
    depreciation_amount, accumulated_amount, book_value,
    office_id
  ) VALUES (
    p_asset_id, v_year, v_month,
    v_monthly_dep, v_new_accum, v_new_bv,
    v_asset.office_id
  );

  RETURN v_monthly_dep;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.calculate_depreciation(UUID) TO authenticated;

-- ============================================================
-- run_monthly_depreciation(p_year, p_month)
-- Batch depreciation for all active PPE in the user's division.
-- Skips already-depreciated and fully-depreciated assets.
-- Returns: count of assets depreciated.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.run_monthly_depreciation(
  p_year  INTEGER,
  p_month INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_asset         RECORD;
  v_monthly_dep   NUMERIC(14,2);
  v_new_accum     NUMERIC(14,2);
  v_new_bv        NUMERIC(14,2);
  v_max_dep       NUMERIC(14,2);
  v_count         INTEGER := 0;
BEGIN
  -- Permission check
  IF NOT procurements.has_permission('asset.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to run depreciation';
  END IF;

  -- Validate month
  IF p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'Month must be between 1 and 12';
  END IF;

  -- Prevent future depreciation
  IF (p_year > EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER)
     OR (p_year = EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
         AND p_month > EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER) THEN
    RAISE EXCEPTION 'Cannot run depreciation for a future period';
  END IF;

  v_division_id := procurements.get_user_division_id();

  -- Loop over all eligible PPE assets
  FOR v_asset IN
    SELECT a.*
      FROM procurements.assets a
     WHERE a.division_id       = v_division_id
       AND a.asset_type        = 'ppe'
       AND a.status            = 'active'
       AND a.deleted_at        IS NULL
       AND a.useful_life_years IS NOT NULL
       AND a.useful_life_years > 0
       AND a.book_value        > a.residual_value
       -- Skip already-depreciated for this period
       AND NOT EXISTS (
         SELECT 1 FROM procurements.depreciation_records dr
          WHERE dr.asset_id     = a.id
            AND dr.period_year  = p_year
            AND dr.period_month = p_month
       )
  LOOP
    -- Straight-line depreciation
    v_monthly_dep := ROUND(
      (v_asset.acquisition_cost - v_asset.residual_value) / (v_asset.useful_life_years * 12),
      2
    );

    -- Cap at remaining depreciable amount
    v_max_dep := v_asset.book_value - v_asset.residual_value;
    IF v_monthly_dep > v_max_dep THEN
      v_monthly_dep := v_max_dep;
    END IF;

    v_new_accum := v_asset.accumulated_depreciation + v_monthly_dep;
    v_new_bv    := v_asset.acquisition_cost - v_new_accum;

    -- Insert depreciation record (trigger updates asset)
    INSERT INTO procurements.depreciation_records (
      asset_id, period_year, period_month,
      depreciation_amount, accumulated_amount, book_value,
      office_id
    ) VALUES (
      v_asset.id, p_year, p_month,
      v_monthly_dep, v_new_accum, v_new_bv,
      v_asset.office_id
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.run_monthly_depreciation(INTEGER, INTEGER) TO authenticated;

-- ============================================================
-- initiate_disposal(p_asset_id, p_method, p_remarks)
-- Marks an asset for disposal. Notifies HOPE role.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.initiate_disposal(
  p_asset_id UUID,
  p_method   TEXT,
  p_remarks  TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_accessible    UUID[];
  v_asset         RECORD;
  v_user_record   RECORD;
BEGIN
  -- Permission check
  IF NOT (procurements.has_permission('asset.dispose') OR procurements.has_permission('asset.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to initiate disposal';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  -- Validate asset
  SELECT * INTO v_asset
    FROM procurements.assets
   WHERE id          = p_asset_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF v_asset.status IN ('disposed', 'for_disposal') THEN
    RAISE EXCEPTION 'Asset is already % ', v_asset.status;
  END IF;

  -- Office scope check
  IF NOT (v_asset.office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to dispose assets in this office';
  END IF;

  -- Update asset status
  UPDATE procurements.assets
     SET status           = 'for_disposal',
         condition_status = 'unserviceable',
         disposal_method  = p_method,
         updated_at       = NOW()
   WHERE id = p_asset_id;

  -- Notify HOPE role for disposal approval
  FOR v_user_record IN
    SELECT DISTINCT ur.user_id
      FROM procurements.user_roles ur
      JOIN procurements.roles r ON r.id = ur.role_id
     WHERE r.code         = 'hope'
       AND ur.division_id = v_division_id
       AND ur.is_active   = true
       AND ur.revoked_at  IS NULL
  LOOP
    INSERT INTO procurements.notifications (
      user_id, title, message, type,
      reference_type, reference_id, office_id
    ) VALUES (
      v_user_record.user_id,
      'Asset Disposal Request',
      'Asset ' || v_asset.property_number || ' (' || COALESCE(v_asset.description, 'N/A')
        || ') has been marked for disposal via ' || p_method
        || '. ' || COALESCE(p_remarks, ''),
      'approval',
      'asset',
      p_asset_id,
      v_asset.office_id
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.initiate_disposal(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- complete_disposal(p_asset_id, p_disposal_reference)
-- Completes disposal of an asset. Sets final status and closes
-- the current assignment.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.complete_disposal(
  p_asset_id           UUID,
  p_disposal_reference TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_division_id   UUID;
  v_accessible    UUID[];
  v_asset         RECORD;
BEGIN
  -- Permission check
  IF NOT (procurements.has_permission('asset.dispose') OR procurements.has_permission('asset.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to complete disposal';
  END IF;

  v_division_id := procurements.get_user_division_id();
  v_accessible  := procurements.get_user_accessible_office_ids();

  -- Validate asset
  SELECT * INTO v_asset
    FROM procurements.assets
   WHERE id          = p_asset_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF v_asset.status <> 'for_disposal' THEN
    RAISE EXCEPTION 'Asset must have status for_disposal to complete disposal (current: %)', v_asset.status;
  END IF;

  -- Office scope check
  IF NOT (v_asset.office_id = ANY(v_accessible)) THEN
    RAISE EXCEPTION 'You do not have access to complete disposal for this office';
  END IF;

  -- Update asset to disposed
  UPDATE procurements.assets
     SET status              = 'disposed',
         condition_status    = 'disposed',
         disposal_date       = CURRENT_DATE,
         disposal_reference  = p_disposal_reference,
         current_custodian_id = NULL,
         updated_at          = NOW()
   WHERE id = p_asset_id;

  -- Close current assignment
  UPDATE procurements.asset_assignments
     SET is_current    = false,
         returned_date = CURRENT_DATE,
         updated_at    = NOW()
   WHERE asset_id   = p_asset_id
     AND is_current = true;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.complete_disposal(UUID, TEXT) TO authenticated;
