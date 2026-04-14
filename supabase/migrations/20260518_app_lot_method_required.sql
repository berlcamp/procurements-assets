-- Phase 3: Make APP lot procurement_method required
--
-- Depends on 20260517_unify_procurement_modes.sql (canonical enum must exist).
-- Backfills NULL values, then enforces NOT NULL + CHECK constraint.
-- Updates create_app_lot RPC to require method and assign_items_to_lot
-- to warn on mode mismatch.

-- ============================================================
-- 1. Backfill NULL procurement_method on ALL lots (including soft-deleted)
--    Strategy: use the most common mode among assigned items,
--    fall back to competitive_bidding.
-- ============================================================
UPDATE procurements.app_lots al
   SET procurement_method = COALESCE(
     (
       SELECT sub.mode_val
         FROM (
           SELECT ai.procurement_mode AS mode_val, COUNT(*) AS cnt
             FROM procurements.app_items ai
            WHERE ai.lot_id = al.id
              AND ai.procurement_mode IS NOT NULL
            GROUP BY ai.procurement_mode
            ORDER BY cnt DESC
            LIMIT 1
         ) sub
     ),
     'competitive_bidding'
   )
 WHERE al.procurement_method IS NULL;

-- ============================================================
-- 1b. Normalize old procurement_method values on app_lots
--     (Phase 2 migration normalized ppmp_lots, app_items, and
--     purchase_requests but not app_lots — fix that here.)
-- ============================================================
UPDATE procurements.app_lots
   SET procurement_method = 'svp'
 WHERE procurement_method = 'small_value';

UPDATE procurements.app_lots
   SET procurement_method = 'negotiated'
 WHERE procurement_method = 'negotiated_procurement';

UPDATE procurements.app_lots
   SET procurement_method = 'competitive_bidding'
 WHERE procurement_method IN ('two_stage_bidding', 'by_administration');

-- Catch any other non-canonical values
UPDATE procurements.app_lots
   SET procurement_method = 'competitive_bidding'
 WHERE procurement_method NOT IN (
   'competitive_bidding','limited_source_bidding','direct_contracting',
   'repeat_order','shopping','svp','negotiated','agency_to_agency','emergency'
 );

-- ============================================================
-- 2. Enforce NOT NULL + CHECK
-- ============================================================
ALTER TABLE procurements.app_lots
  ALTER COLUMN procurement_method SET NOT NULL;

ALTER TABLE procurements.app_lots
  ADD CONSTRAINT chk_app_lot_procurement_method
  CHECK (procurement_method IN (
    'competitive_bidding','limited_source_bidding','direct_contracting',
    'repeat_order','shopping','svp','negotiated','agency_to_agency','emergency'
  ));

-- ============================================================
-- 3. Update create_app_lot RPC — require procurement_method
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.create_app_lot(
  p_app_id              UUID,
  p_lot_name            TEXT,
  p_description         TEXT DEFAULT NULL,
  p_procurement_method  TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app          RECORD;
  v_version_id   UUID;
  v_next_lot_num INTEGER;
  v_lot_id       UUID;
BEGIN
  -- Require procurement_method
  IF p_procurement_method IS NULL OR TRIM(p_procurement_method) = '' THEN
    RAISE EXCEPTION 'Procurement method is required when creating an APP lot';
  END IF;

  IF p_procurement_method NOT IN (
    'competitive_bidding','limited_source_bidding','direct_contracting',
    'repeat_order','shopping','svp','negotiated','agency_to_agency','emergency'
  ) THEN
    RAISE EXCEPTION 'Invalid procurement method: %', p_procurement_method;
  END IF;

  SELECT * INTO v_app
    FROM procurements.apps
   WHERE id          = p_app_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  IF NOT procurements.has_permission('app.bac_manage_lots') THEN
    RAISE EXCEPTION 'Insufficient permissions to manage APP lots';
  END IF;

  -- Get current working version
  SELECT id INTO v_version_id
    FROM procurements.app_versions
   WHERE app_id = p_app_id
     AND status NOT IN ('approved','superseded')
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'No active version found for APP %', p_app_id;
  END IF;

  -- Get next lot number
  SELECT COALESCE(MAX(lot_number), 0) + 1
    INTO v_next_lot_num
    FROM procurements.app_lots
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL;

  INSERT INTO procurements.app_lots (
    app_id, app_version_id, lot_number, lot_name, description,
    procurement_method, division_id, created_by
  ) VALUES (
    p_app_id, v_version_id, v_next_lot_num, p_lot_name, p_description,
    p_procurement_method, v_app.division_id, auth.uid()
  )
  RETURNING id INTO v_lot_id;

  RETURN v_lot_id;
END;
$$;

-- ============================================================
-- 4. Update assign_items_to_lot — add mode mismatch warning via NOTICE
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.assign_items_to_lot(
  p_lot_id       UUID,
  p_app_item_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot        RECORD;
  v_count      INTEGER := 0;
  v_item       RECORD;
  v_item_id    UUID;
  v_next_num   INTEGER;
  v_total_cost NUMERIC(15,2);
BEGIN
  SELECT al.*, a.division_id
    INTO v_lot
    FROM procurements.app_lots al
    JOIN procurements.apps a ON a.id = al.app_id
   WHERE al.id = p_lot_id
     AND al.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lot % not found', p_lot_id;
  END IF;

  IF v_lot.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Access denied to lot %', p_lot_id;
  END IF;

  IF NOT procurements.has_permission('app.bac_manage_lots') THEN
    RAISE EXCEPTION 'Insufficient permissions to manage lot items';
  END IF;

  IF v_lot.status = 'finalized' THEN
    RAISE EXCEPTION 'Cannot modify finalized lot %', p_lot_id;
  END IF;

  -- Get current max lot_item_number
  SELECT COALESCE(MAX(lot_item_number), 0)
    INTO v_next_num
    FROM procurements.app_items
   WHERE lot_id = p_lot_id;

  FOREACH v_item_id IN ARRAY p_app_item_ids LOOP
    SELECT * INTO v_item
      FROM procurements.app_items
     WHERE id = v_item_id
       AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'APP item % not found', v_item_id;
    END IF;

    IF v_item.hope_review_status <> 'approved' THEN
      RAISE EXCEPTION 'Item % is not HOPE-approved (status: %). Only approved items can be assigned to lots.',
        v_item_id, v_item.hope_review_status;
    END IF;

    -- Warn if item mode doesn't match lot method (NOTICE, not exception)
    IF v_item.procurement_mode IS NOT NULL AND v_item.procurement_mode <> v_lot.procurement_method THEN
      RAISE NOTICE 'Item % procurement mode (%) differs from lot method (%). Item assigned anyway.',
        v_item_id, v_item.procurement_mode, v_lot.procurement_method;
    END IF;

    v_next_num := v_next_num + 1;

    UPDATE procurements.app_items
       SET lot_id          = p_lot_id,
           lot_item_number = v_next_num,
           updated_at      = NOW()
     WHERE id = v_item_id;

    v_count := v_count + 1;
  END LOOP;

  -- Recalculate lot total
  SELECT COALESCE(SUM(estimated_budget), 0)
    INTO v_total_cost
    FROM procurements.app_items
   WHERE lot_id = p_lot_id
     AND deleted_at IS NULL;

  UPDATE procurements.app_lots
     SET total_estimated_cost = v_total_cost,
         updated_at           = NOW()
   WHERE id = p_lot_id;

  RETURN v_count;
END;
$$;
