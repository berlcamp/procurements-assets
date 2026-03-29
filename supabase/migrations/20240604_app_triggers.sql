-- Phase 6: APP triggers

-- ============================================================
-- Trigger 1: Update APP status based on activity
-- When items are added, move from 'populating' to 'indicative'.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.update_app_status_on_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app RECORD;
BEGIN
  SELECT * INTO v_app
    FROM procurements.apps
   WHERE id = NEW.app_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- If APP is still in populating status and items are being added, move to indicative
  IF v_app.status = 'populating' THEN
    UPDATE procurements.apps
       SET status     = 'indicative',
           updated_at = NOW()
     WHERE id = NEW.app_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_app_status_on_item_insert
  AFTER INSERT ON procurements.app_items
  FOR EACH ROW
  EXECUTE FUNCTION procurements.update_app_status_on_item_change();

-- ============================================================
-- Trigger 2: Recalculate app_version total on item changes
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.recalc_app_version_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_version_id UUID;
  v_total      NUMERIC(15,2);
BEGIN
  v_version_id := COALESCE(NEW.app_version_id, OLD.app_version_id);

  SELECT COALESCE(SUM(estimated_budget), 0)
    INTO v_total
    FROM procurements.app_items
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL;

  UPDATE procurements.app_versions
     SET total_estimated_cost = v_total
   WHERE id = v_version_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_recalc_app_version_total
  AFTER INSERT OR UPDATE OR DELETE ON procurements.app_items
  FOR EACH ROW
  EXECUTE FUNCTION procurements.recalc_app_version_total();

-- ============================================================
-- Trigger 3: Snapshot approved APP version
-- Captures all items and lots as JSONB on approval.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.snapshot_approved_app_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_items JSONB;
  v_lots  JSONB;
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(ai.*)), '[]'::jsonb)
      INTO v_items
      FROM procurements.app_items ai
     WHERE ai.app_version_id = NEW.id
       AND ai.deleted_at IS NULL;

    SELECT COALESCE(jsonb_agg(row_to_json(al.*)), '[]'::jsonb)
      INTO v_lots
      FROM procurements.app_lots al
     WHERE al.app_version_id = NEW.id
       AND al.deleted_at IS NULL;

    NEW.snapshot_data = jsonb_build_object(
      'version',        row_to_json(NEW.*),
      'items',          v_items,
      'lots',           v_lots,
      'snapshotted_at', NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_snapshot_approved_app_version
  BEFORE UPDATE ON procurements.app_versions
  FOR EACH ROW
  EXECUTE FUNCTION procurements.snapshot_approved_app_version();

-- ============================================================
-- Update the auto_populate trigger to also create the APP
-- record if it doesn't exist yet.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.auto_populate_app_from_ppmp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app_id         UUID;
  v_app_version_id UUID;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Skip if app_items table doesn't exist yet (safety)
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'procurements'
       AND table_name   = 'app_items'
  ) THEN
    RETURN NEW;
  END IF;

  -- Locate or create the APP for this division + fiscal year
  SELECT id INTO v_app_id
    FROM procurements.apps
   WHERE division_id    = NEW.division_id
     AND fiscal_year_id = NEW.fiscal_year_id
     AND deleted_at     IS NULL
   LIMIT 1;

  IF v_app_id IS NULL THEN
    -- Auto-create APP
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
  END IF;

  SELECT id INTO v_app_version_id
    FROM procurements.app_versions
   WHERE app_id  = v_app_id
     AND status  NOT IN ('final','approved','superseded')
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_app_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Insert approved PPMP projects/lots into app_items
  INSERT INTO procurements.app_items (
    app_version_id,
    app_id,
    source_ppmp_project_id,
    source_ppmp_lot_id,
    source_ppmp_id,
    item_number,
    general_description,
    project_type,
    procurement_mode,
    estimated_budget,
    source_of_funds,
    procurement_start,
    procurement_end,
    delivery_period,
    budget_allocation_id,
    source_office_id,
    remarks,
    hope_review_status,
    created_by
  )
  SELECT
    v_app_version_id,
    v_app_id,
    pp.id,
    pl.id,
    pp.ppmp_id,
    ROW_NUMBER() OVER (ORDER BY pp.project_number, pl.lot_number)
      + COALESCE((
          SELECT MAX(item_number) FROM procurements.app_items
           WHERE app_version_id = v_app_version_id AND deleted_at IS NULL
        ), 0),
    pp.general_description,
    pp.project_type,
    pl.procurement_mode,
    pl.estimated_budget,
    pl.source_of_funds,
    pl.procurement_start,
    pl.procurement_end,
    pl.delivery_period,
    pl.budget_allocation_id,
    pp.office_id,
    pl.remarks,
    'pending',
    pp.created_by
  FROM procurements.ppmp_projects pp
  JOIN procurements.ppmp_versions pv ON pv.id = pp.ppmp_version_id
  JOIN procurements.ppmp_lots pl ON pl.ppmp_project_id = pp.id
  WHERE pv.ppmp_id   = NEW.id
    AND pv.status    = 'approved'
    AND pp.deleted_at IS NULL;

  RETURN NEW;
END;
$$;
