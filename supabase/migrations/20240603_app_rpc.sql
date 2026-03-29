-- Phase 6: APP RPC functions

-- ============================================================
-- hope_review_app_item(p_app_item_id, p_action, p_remarks)
-- HOPE approves or remarks on individual PPMP rows in APP.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.hope_review_app_item(
  p_app_item_id UUID,
  p_action      TEXT,
  p_remarks     TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_item   RECORD;
  v_app    RECORD;
BEGIN
  IF p_action NOT IN ('approve', 'remark') THEN
    RAISE EXCEPTION 'Invalid action %. Must be ''approve'' or ''remark''', p_action;
  END IF;

  IF p_action = 'remark' AND (p_remarks IS NULL OR LENGTH(TRIM(p_remarks)) < 5) THEN
    RAISE EXCEPTION 'Remarks are required when remarking an item (min 5 characters)';
  END IF;

  SELECT ai.*, a.division_id, a.status AS app_status
    INTO v_item
    FROM procurements.app_items ai
    JOIN procurements.apps a ON a.id = ai.app_id
   WHERE ai.id = p_app_item_id
     AND ai.deleted_at IS NULL
     AND a.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP item % not found', p_app_item_id;
  END IF;

  IF v_item.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Access denied to APP item %', p_app_item_id;
  END IF;

  IF NOT procurements.has_permission('app.hope_review') THEN
    RAISE EXCEPTION 'Insufficient permissions to review APP items';
  END IF;

  IF v_item.hope_review_status NOT IN ('pending', 'remarked') THEN
    RAISE EXCEPTION 'Item % has already been reviewed (status: %)', p_app_item_id, v_item.hope_review_status;
  END IF;

  UPDATE procurements.app_items
     SET hope_review_status = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'remarked' END,
         hope_reviewed_by   = auth.uid(),
         hope_reviewed_at   = NOW(),
         hope_remarks       = p_remarks,
         updated_at         = NOW()
   WHERE id = p_app_item_id;
END;
$$;

-- ============================================================
-- hope_batch_review_app_items(p_app_item_ids, p_action, p_remarks)
-- Batch review: approve or remark multiple items at once.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.hope_batch_review_app_items(
  p_app_item_ids UUID[],
  p_action       TEXT,
  p_remarks      TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_item_id UUID;
BEGIN
  FOREACH v_item_id IN ARRAY p_app_item_ids LOOP
    PERFORM procurements.hope_review_app_item(v_item_id, p_action, p_remarks);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ============================================================
-- create_app_lot(p_app_id, p_lot_name, p_description, p_procurement_method)
-- BAC creates a new Lot for grouping approved items.
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
-- assign_items_to_lot(p_lot_id, p_app_item_ids)
-- BAC assigns HOPE-approved items to a lot.
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

-- ============================================================
-- unassign_items_from_lot(p_app_item_ids)
-- Remove items from their currently assigned lot.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.unassign_items_from_lot(
  p_app_item_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_item_id  UUID;
  v_item     RECORD;
  v_lot_ids  UUID[] := '{}';
  v_lot_id   UUID;
  v_total    NUMERIC(15,2);
  v_count    INTEGER := 0;
BEGIN
  FOREACH v_item_id IN ARRAY p_app_item_ids LOOP
    SELECT ai.*, a.division_id
      INTO v_item
      FROM procurements.app_items ai
      JOIN procurements.apps a ON a.id = ai.app_id
     WHERE ai.id = v_item_id
       AND ai.deleted_at IS NULL;

    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_item.division_id <> procurements.get_user_division_id() THEN
      RAISE EXCEPTION 'Access denied';
    END IF;

    IF v_item.lot_id IS NOT NULL THEN
      -- Check lot is not finalized
      IF EXISTS (
        SELECT 1 FROM procurements.app_lots
         WHERE id = v_item.lot_id AND status = 'finalized'
      ) THEN
        RAISE EXCEPTION 'Cannot remove item from finalized lot';
      END IF;

      v_lot_ids := v_lot_ids || v_item.lot_id;

      UPDATE procurements.app_items
         SET lot_id = NULL, lot_item_number = NULL, updated_at = NOW()
       WHERE id = v_item_id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  -- Recalculate totals for affected lots
  FOREACH v_lot_id IN ARRAY v_lot_ids LOOP
    SELECT COALESCE(SUM(estimated_budget), 0) INTO v_total
      FROM procurements.app_items
     WHERE lot_id = v_lot_id AND deleted_at IS NULL;

    UPDATE procurements.app_lots
       SET total_estimated_cost = v_total, updated_at = NOW()
     WHERE id = v_lot_id;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================
-- finalize_lot(p_lot_id)
-- BAC marks a Lot as finalized (ready for procurement).
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.finalize_lot(
  p_lot_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot      RECORD;
  v_item_cnt INTEGER;
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
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT procurements.has_permission('app.bac_finalize_lot') THEN
    RAISE EXCEPTION 'Insufficient permissions to finalize lots';
  END IF;

  IF v_lot.status = 'finalized' THEN
    RAISE EXCEPTION 'Lot % is already finalized', p_lot_id;
  END IF;

  -- Lot must have at least one item
  SELECT COUNT(*) INTO v_item_cnt
    FROM procurements.app_items
   WHERE lot_id = p_lot_id
     AND deleted_at IS NULL;

  IF v_item_cnt = 0 THEN
    RAISE EXCEPTION 'Cannot finalize an empty lot. Assign at least one item.';
  END IF;

  UPDATE procurements.app_lots
     SET status       = 'finalized',
         finalized_by = auth.uid(),
         finalized_at = NOW(),
         updated_at   = NOW()
   WHERE id = p_lot_id;
END;
$$;

-- ============================================================
-- finalize_app(p_app_id)
-- Marks APP as FINAL. All items must be reviewed, all approved
-- items must be in lots, all lots must be finalized.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.finalize_app(
  p_app_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app         RECORD;
  v_version_id  UUID;
  v_pending_cnt INTEGER;
  v_unlotted    INTEGER;
  v_unfinal_lot INTEGER;
  v_total       NUMERIC(15,2);
BEGIN
  SELECT * INTO v_app
    FROM procurements.apps
   WHERE id = p_app_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  IF NOT procurements.has_permission('app.finalize') THEN
    RAISE EXCEPTION 'Insufficient permissions to finalize APP';
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.app_versions
   WHERE app_id = p_app_id
     AND status NOT IN ('approved','superseded')
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'No active version for APP %', p_app_id;
  END IF;

  -- All items must be reviewed (no pending)
  SELECT COUNT(*) INTO v_pending_cnt
    FROM procurements.app_items
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND hope_review_status = 'pending';

  IF v_pending_cnt > 0 THEN
    RAISE EXCEPTION 'Cannot finalize APP: % items still pending HOPE review', v_pending_cnt;
  END IF;

  -- All approved items must be assigned to lots
  SELECT COUNT(*) INTO v_unlotted
    FROM procurements.app_items
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND hope_review_status = 'approved'
     AND lot_id IS NULL;

  IF v_unlotted > 0 THEN
    RAISE EXCEPTION 'Cannot finalize APP: % approved items are not assigned to lots', v_unlotted;
  END IF;

  -- All lots must be finalized
  SELECT COUNT(*) INTO v_unfinal_lot
    FROM procurements.app_lots
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND status <> 'finalized';

  IF v_unfinal_lot > 0 THEN
    RAISE EXCEPTION 'Cannot finalize APP: % lots are not yet finalized', v_unfinal_lot;
  END IF;

  -- Calculate total
  SELECT COALESCE(SUM(estimated_budget), 0) INTO v_total
    FROM procurements.app_items
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND hope_review_status = 'approved';

  UPDATE procurements.app_versions
     SET status             = 'final',
         indicative_final   = 'final',
         total_estimated_cost = v_total
   WHERE id = v_version_id;

  UPDATE procurements.apps
     SET status           = 'final',
         indicative_final = 'final',
         updated_at       = NOW()
   WHERE id = p_app_id;
END;
$$;

-- ============================================================
-- approve_app(p_app_id, p_notes)
-- HOPE final approval. Enables PR creation for End Users.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.approve_app(
  p_app_id UUID,
  p_notes  TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app        RECORD;
  v_version_id UUID;
BEGIN
  SELECT * INTO v_app
    FROM procurements.apps
   WHERE id = p_app_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  IF NOT procurements.has_permission('app.approve') THEN
    RAISE EXCEPTION 'Insufficient permissions to approve APP';
  END IF;

  IF v_app.status <> 'final' THEN
    RAISE EXCEPTION 'APP must be in final status before approval (current: %)', v_app.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.app_versions
   WHERE app_id = p_app_id
     AND status = 'final'
   ORDER BY version_number DESC
   LIMIT 1;

  UPDATE procurements.app_versions
     SET status       = 'approved',
         approved_by  = auth.uid(),
         approved_at  = NOW()
   WHERE id = v_version_id;

  -- Supersede older versions
  UPDATE procurements.app_versions
     SET status = 'superseded'
   WHERE app_id = p_app_id
     AND id <> v_version_id
     AND status NOT IN ('approved','superseded');

  UPDATE procurements.apps
     SET status      = 'approved',
         approved_by = auth.uid(),
         approved_at = NOW(),
         updated_at  = NOW()
   WHERE id = p_app_id;
END;
$$;

-- ============================================================
-- get_app_summary(p_app_id)
-- Returns APP summary with item and lot counts.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.get_app_summary(
  p_app_id UUID
)
RETURNS TABLE (
  total_items       BIGINT,
  pending_items     BIGINT,
  approved_items    BIGINT,
  remarked_items    BIGINT,
  lotted_items      BIGINT,
  unlotted_items    BIGINT,
  total_lots        BIGINT,
  finalized_lots    BIGINT,
  draft_lots        BIGINT,
  total_budget      NUMERIC(15,2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_version_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM procurements.apps
     WHERE id = p_app_id
       AND division_id = procurements.get_user_division_id()
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.app_versions
   WHERE app_id = p_app_id
   ORDER BY version_number DESC
   LIMIT 1;

  RETURN QUERY
  SELECT
    COUNT(*)                                                        AS total_items,
    COUNT(*) FILTER (WHERE ai.hope_review_status = 'pending')       AS pending_items,
    COUNT(*) FILTER (WHERE ai.hope_review_status = 'approved')      AS approved_items,
    COUNT(*) FILTER (WHERE ai.hope_review_status = 'remarked')      AS remarked_items,
    COUNT(*) FILTER (WHERE ai.lot_id IS NOT NULL)                   AS lotted_items,
    COUNT(*) FILTER (WHERE ai.lot_id IS NULL AND ai.hope_review_status = 'approved') AS unlotted_items,
    (SELECT COUNT(*) FROM procurements.app_lots
      WHERE app_version_id = v_version_id AND deleted_at IS NULL)   AS total_lots,
    (SELECT COUNT(*) FROM procurements.app_lots
      WHERE app_version_id = v_version_id AND deleted_at IS NULL
        AND status = 'finalized')                                   AS finalized_lots,
    (SELECT COUNT(*) FROM procurements.app_lots
      WHERE app_version_id = v_version_id AND deleted_at IS NULL
        AND status = 'draft')                                       AS draft_lots,
    COALESCE(SUM(ai.estimated_budget), 0)                           AS total_budget
  FROM procurements.app_items ai
  WHERE ai.app_version_id = v_version_id
    AND ai.deleted_at IS NULL;
END;
$$;

-- ============================================================
-- create_app_for_division(p_division_id, p_fiscal_year_id)
-- Creates an APP record with an initial draft version.
-- Called automatically or manually.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.create_app_for_division(
  p_division_id    UUID,
  p_fiscal_year_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app_id UUID;
BEGIN
  -- Check if APP already exists
  SELECT id INTO v_app_id
    FROM procurements.apps
   WHERE division_id = p_division_id
     AND fiscal_year_id = p_fiscal_year_id
     AND deleted_at IS NULL;

  IF v_app_id IS NOT NULL THEN
    RETURN v_app_id;
  END IF;

  INSERT INTO procurements.apps (
    division_id, fiscal_year_id, status, indicative_final, created_by
  ) VALUES (
    p_division_id, p_fiscal_year_id, 'populating', 'indicative', auth.uid()
  )
  RETURNING id INTO v_app_id;

  INSERT INTO procurements.app_versions (
    app_id, version_number, version_type, status, indicative_final, created_by
  ) VALUES (
    v_app_id, 1, 'original', 'draft', 'indicative', auth.uid()
  );

  RETURN v_app_id;
END;
$$;
