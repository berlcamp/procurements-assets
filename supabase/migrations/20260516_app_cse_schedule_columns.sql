-- Phase 1: Additive columns for government procurement alignment
--
-- Issue 1: source_ppmp_project_description on app_items (visual grouping by parent project)
-- Issue 2: is_cse on ppmp_lots + app_items (CSE vs Non-CSE categorization per GPPB APP form)
-- Issue 6: Structured schedule quarter fields on ppmp_lots + app_items
--
-- Non-destructive. All columns are nullable or have safe defaults.

-- ============================================================
-- 1. Issue 1 — Source PPMP project description on app_items
-- ============================================================
ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS source_ppmp_project_description TEXT;

-- Backfill existing rows from ppmp_projects
UPDATE procurements.app_items ai
   SET source_ppmp_project_description = pp.general_description
  FROM procurements.ppmp_projects pp
 WHERE ai.source_ppmp_project_id = pp.id
   AND ai.source_ppmp_project_description IS NULL;

-- ============================================================
-- 2. Issue 2 — CSE / Non-CSE categorization
-- ============================================================
ALTER TABLE procurements.ppmp_lots
  ADD COLUMN IF NOT EXISTS is_cse BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS is_cse BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 3. Issue 6 — Schedule quarter breakdown
-- ============================================================
ALTER TABLE procurements.ppmp_lots
  ADD COLUMN IF NOT EXISTS schedule_quarter TEXT
    CHECK (schedule_quarter IS NULL OR schedule_quarter IN ('Q1','Q2','Q3','Q4')),
  ADD COLUMN IF NOT EXISTS advertisement_date TEXT,
  ADD COLUMN IF NOT EXISTS bid_opening_date TEXT,
  ADD COLUMN IF NOT EXISTS award_date TEXT,
  ADD COLUMN IF NOT EXISTS contract_signing_date TEXT;

ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS schedule_quarter TEXT
    CHECK (schedule_quarter IS NULL OR schedule_quarter IN ('Q1','Q2','Q3','Q4')),
  ADD COLUMN IF NOT EXISTS advertisement_date TEXT,
  ADD COLUMN IF NOT EXISTS bid_opening_date TEXT,
  ADD COLUMN IF NOT EXISTS award_date TEXT,
  ADD COLUMN IF NOT EXISTS contract_signing_date TEXT;

-- ============================================================
-- 4. Update auto_populate_app_from_ppmp() to propagate new fields
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.auto_populate_app_from_ppmp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app_id           UUID;
  v_app_version_id   UUID;
  v_app_status       TEXT;
  v_is_amendment      BOOLEAN;
  v_approved_ver_id  UUID;
  v_next_ver_num     INTEGER;
BEGIN
  -- Only fire when PPMP transitions to 'approved'
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Safety: skip if app_items table doesn't exist yet
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'procurements'
       AND table_name   = 'app_items'
  ) THEN
    RETURN NEW;
  END IF;

  -- Check if this is an amendment (version > 1 means re-approval)
  v_is_amendment := (NEW.current_version > 1);

  -- Locate or create the APP for this division + fiscal year
  SELECT id, status INTO v_app_id, v_app_status
    FROM procurements.apps
   WHERE division_id    = NEW.division_id
     AND fiscal_year_id = NEW.fiscal_year_id
     AND deleted_at     IS NULL
   LIMIT 1;

  IF v_app_id IS NULL THEN
    -- Auto-create APP (first PPMP approval for this division + FY)
    INSERT INTO procurements.apps (
      division_id, fiscal_year_id, status, indicative_final, created_by
    ) VALUES (
      NEW.division_id, NEW.fiscal_year_id, 'populating', 'indicative', NEW.approved_by
    )
    RETURNING id INTO v_app_id;

    INSERT INTO procurements.app_versions (
      app_id, version_number, version_type, status, indicative_final, created_by
    ) VALUES (
      v_app_id, 1, 'original', 'draft', 'indicative', NEW.approved_by
    );

    v_app_status := 'populating';
  END IF;

  -- Find a working (editable) APP version
  SELECT id INTO v_app_version_id
    FROM procurements.app_versions
   WHERE app_id = v_app_id
     AND status NOT IN ('final', 'approved', 'superseded')
   ORDER BY version_number DESC
   LIMIT 1;

  -- If no editable version exists AND this is an amendment,
  -- auto-create a supplemental APP version
  IF v_app_version_id IS NULL AND v_is_amendment THEN
    SELECT COALESCE(MAX(version_number), 0) + 1
      INTO v_next_ver_num
      FROM procurements.app_versions
     WHERE app_id = v_app_id;

    INSERT INTO procurements.app_versions (
      app_id, version_number, version_type,
      amendment_justification,
      status, indicative_final, created_by
    ) VALUES (
      v_app_id, v_next_ver_num, 'supplemental',
      'Auto-created from PPMP amendment (PPMP v' || NEW.current_version || ')',
      'draft', 'indicative', NEW.approved_by
    )
    RETURNING id INTO v_app_version_id;

    -- Clone all existing approved items from the last approved version
    SELECT id INTO v_approved_ver_id
      FROM procurements.app_versions
     WHERE app_id = v_app_id
       AND status = 'approved'
     ORDER BY version_number DESC
     LIMIT 1;

    IF v_approved_ver_id IS NOT NULL THEN
      -- Clone items (excluding old items from this same PPMP)
      INSERT INTO procurements.app_items (
        app_version_id, app_id,
        source_ppmp_project_id, source_ppmp_lot_id, source_ppmp_id,
        item_number, general_description, project_type,
        procurement_mode, estimated_budget, source_of_funds,
        procurement_start, procurement_end, delivery_period,
        budget_allocation_id, source_office_id,
        hope_review_status, hope_reviewed_by, hope_reviewed_at, hope_remarks,
        lot_id, lot_item_number, remarks, created_by,
        -- New fields
        source_ppmp_project_description, is_cse,
        schedule_quarter, advertisement_date, bid_opening_date,
        award_date, contract_signing_date
      )
      SELECT
        v_app_version_id, app_id,
        source_ppmp_project_id, source_ppmp_lot_id, source_ppmp_id,
        item_number, general_description, project_type,
        procurement_mode, estimated_budget, source_of_funds,
        procurement_start, procurement_end, delivery_period,
        budget_allocation_id, source_office_id,
        hope_review_status, hope_reviewed_by, hope_reviewed_at, hope_remarks,
        NULL, NULL, remarks, created_by,
        -- New fields
        source_ppmp_project_description, is_cse,
        schedule_quarter, advertisement_date, bid_opening_date,
        award_date, contract_signing_date
      FROM procurements.app_items
      WHERE app_version_id = v_approved_ver_id
        AND deleted_at IS NULL
        AND source_ppmp_id <> NEW.id;

      -- Clone lots (without item assignments)
      INSERT INTO procurements.app_lots (
        app_id, app_version_id, lot_number, lot_name, description,
        procurement_method, total_estimated_cost, status,
        division_id, created_by
      )
      SELECT
        app_id, v_app_version_id, lot_number, lot_name, description,
        procurement_method, 0, 'draft',
        division_id, created_by
      FROM procurements.app_lots
      WHERE app_version_id = v_approved_ver_id
        AND deleted_at IS NULL;
    END IF;

    -- Reset APP status
    UPDATE procurements.apps
       SET status     = 'indicative',
           updated_at = NOW()
     WHERE id = v_app_id
       AND status IN ('approved', 'final', 'posted');
  END IF;

  -- Still no editable version — bail out
  IF v_app_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- For amendments: soft-delete old APP items from this same PPMP
  IF v_is_amendment THEN
    UPDATE procurements.app_items
       SET deleted_at = NOW()
     WHERE app_version_id = v_app_version_id
       AND source_ppmp_id = NEW.id
       AND deleted_at IS NULL;
  END IF;

  -- Insert the newly approved PPMP projects/lots as APP items
  INSERT INTO procurements.app_items (
    app_version_id, app_id,
    source_ppmp_project_id, source_ppmp_lot_id, source_ppmp_id,
    item_number,
    general_description, project_type,
    procurement_mode, estimated_budget, source_of_funds,
    procurement_start, procurement_end, delivery_period,
    budget_allocation_id, source_office_id,
    remarks, hope_review_status, created_by,
    -- New fields
    source_ppmp_project_description, is_cse,
    schedule_quarter, advertisement_date, bid_opening_date,
    award_date, contract_signing_date
  )
  SELECT
    v_app_version_id, v_app_id,
    pp.id, pl.id, pp.ppmp_id,
    ROW_NUMBER() OVER (ORDER BY pp.project_number, pl.lot_number)
      + COALESCE((
          SELECT MAX(item_number) FROM procurements.app_items
           WHERE app_version_id = v_app_version_id AND deleted_at IS NULL
        ), 0),
    pp.general_description, pp.project_type,
    pl.procurement_mode, pl.estimated_budget, pl.source_of_funds,
    pl.procurement_start, pl.procurement_end, pl.delivery_period,
    pl.budget_allocation_id, pp.office_id,
    pl.remarks, 'pending', pp.created_by,
    -- New fields
    pp.general_description, pl.is_cse,
    pl.schedule_quarter, pl.advertisement_date, pl.bid_opening_date,
    pl.award_date, pl.contract_signing_date
  FROM procurements.ppmp_projects pp
  JOIN procurements.ppmp_versions pv ON pv.id = pp.ppmp_version_id
  JOIN procurements.ppmp_lots pl ON pl.ppmp_project_id = pp.id
  WHERE pv.ppmp_id    = NEW.id
    AND pv.status     = 'approved'
    AND pp.deleted_at IS NULL;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 5. Update create_app_amendment() to clone new fields
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.create_app_amendment(
  p_app_id        UUID,
  p_justification TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app             RECORD;
  v_approved_ver    RECORD;
  v_next_version    INTEGER;
  v_new_version_id  UUID;
BEGIN
  SELECT * INTO v_app
    FROM procurements.apps
   WHERE id          = p_app_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  IF NOT procurements.has_permission('app.amend') THEN
    RAISE EXCEPTION 'Insufficient permissions to amend APP %', p_app_id;
  END IF;

  IF v_app.status NOT IN ('approved', 'final', 'posted') THEN
    RAISE EXCEPTION 'Only approved/final/posted APPs can be amended (current status: %)', v_app.status;
  END IF;

  -- Prevent multiple draft versions
  IF EXISTS (
    SELECT 1 FROM procurements.app_versions
     WHERE app_id = p_app_id
       AND status IN ('draft', 'under_review', 'bac_finalization')
  ) THEN
    RAISE EXCEPTION 'An amendment is already in progress for APP %. Finish or discard it first.', p_app_id;
  END IF;

  -- Find the approved version to clone
  SELECT * INTO v_approved_ver
    FROM procurements.app_versions
   WHERE app_id = p_app_id
     AND status = 'approved'
   ORDER BY version_number DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No approved version found for APP %', p_app_id;
  END IF;

  v_next_version := v_app.current_version + 1;

  -- Create new amendment version
  INSERT INTO procurements.app_versions (
    app_id, version_number, version_type, amendment_justification,
    total_estimated_cost, status, indicative_final, created_by
  ) VALUES (
    p_app_id, v_next_version, 'amendment', p_justification,
    v_approved_ver.total_estimated_cost, 'draft', 'indicative', auth.uid()
  )
  RETURNING id INTO v_new_version_id;

  -- Clone items (carry forward all fields including new ones)
  INSERT INTO procurements.app_items (
    app_version_id, app_id,
    source_ppmp_project_id, source_ppmp_lot_id, source_ppmp_id,
    item_number, general_description, project_type,
    procurement_mode, estimated_budget, source_of_funds,
    procurement_start, procurement_end, delivery_period,
    budget_allocation_id, source_office_id,
    hope_review_status, hope_reviewed_by, hope_reviewed_at, hope_remarks,
    remarks, created_by,
    -- New fields
    source_ppmp_project_description, is_cse,
    schedule_quarter, advertisement_date, bid_opening_date,
    award_date, contract_signing_date
  )
  SELECT
    v_new_version_id, app_id,
    source_ppmp_project_id, source_ppmp_lot_id, source_ppmp_id,
    item_number, general_description, project_type,
    procurement_mode, estimated_budget, source_of_funds,
    procurement_start, procurement_end, delivery_period,
    budget_allocation_id, source_office_id,
    hope_review_status, hope_reviewed_by, hope_reviewed_at, hope_remarks,
    remarks, created_by,
    -- New fields
    source_ppmp_project_description, is_cse,
    schedule_quarter, advertisement_date, bid_opening_date,
    award_date, contract_signing_date
  FROM procurements.app_items
  WHERE app_version_id = v_approved_ver.id
    AND deleted_at IS NULL;

  -- Clone lots (reset to draft)
  INSERT INTO procurements.app_lots (
    app_id, app_version_id, lot_number, lot_name, description,
    procurement_method, total_estimated_cost, status,
    division_id, created_by
  )
  SELECT
    app_id, v_new_version_id, lot_number, lot_name, description,
    procurement_method, total_estimated_cost, 'draft',
    division_id, created_by
  FROM procurements.app_lots
  WHERE app_version_id = v_approved_ver.id
    AND deleted_at IS NULL;

  -- Reassign cloned items to their corresponding cloned lots
  UPDATE procurements.app_items new_ai
     SET lot_id = new_lot.id
    FROM procurements.app_items old_ai
    JOIN procurements.app_lots old_lot ON old_lot.id = old_ai.lot_id
    JOIN procurements.app_lots new_lot
      ON new_lot.app_version_id = v_new_version_id
     AND new_lot.lot_number     = old_lot.lot_number
   WHERE new_ai.app_version_id = v_new_version_id
     AND old_ai.app_version_id = v_approved_ver.id
     AND old_ai.item_number    = new_ai.item_number
     AND old_ai.deleted_at     IS NULL
     AND old_ai.lot_id         IS NOT NULL;

  -- Update parent APP
  UPDATE procurements.apps
     SET current_version = v_next_version,
         status          = 'indicative',
         updated_at      = NOW()
   WHERE id = p_app_id;

  RETURN v_new_version_id;
END;
$$;
