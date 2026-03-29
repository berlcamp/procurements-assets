-- Phase 5: PPMP triggers (Project → Lot → Item hierarchy)

-- ============================================================
-- Trigger 1: Block UPDATE on approved ppmp_versions
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.prevent_approved_ppmp_version_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION
      'Cannot modify an approved PPMP version (version %). Create an amendment instead.',
      OLD.version_number;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_approved_ppmp_version_update
  BEFORE UPDATE ON procurements.ppmp_versions
  FOR EACH ROW
  EXECUTE FUNCTION procurements.prevent_approved_ppmp_version_update();

-- ============================================================
-- Trigger 2: Snapshot approved ppmp_version
-- Captures projects → lots → items hierarchy as JSONB.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.snapshot_approved_ppmp_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_projects JSONB;
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'project', row_to_json(pp.*),
        'lots', (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'lot', row_to_json(pl.*),
              'items', (
                SELECT COALESCE(jsonb_agg(row_to_json(pli.*)), '[]'::jsonb)
                  FROM procurements.ppmp_lot_items pli
                 WHERE pli.ppmp_lot_id = pl.id
              )
            )
          ), '[]'::jsonb)
          FROM procurements.ppmp_lots pl
          WHERE pl.ppmp_project_id = pp.id
        )
      )
    )
    INTO v_projects
    FROM procurements.ppmp_projects pp
    WHERE pp.ppmp_version_id = NEW.id
      AND pp.deleted_at      IS NULL;

    NEW.snapshot_data = jsonb_build_object(
      'version',        row_to_json(NEW.*),
      'projects',       COALESCE(v_projects, '[]'::jsonb),
      'snapshotted_at', NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_snapshot_approved_ppmp_version
  BEFORE UPDATE ON procurements.ppmp_versions
  FOR EACH ROW
  EXECUTE FUNCTION procurements.snapshot_approved_ppmp_version();

-- ============================================================
-- Trigger 3: Sync parent ppmps when a version is approved
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.sync_ppmp_on_version_approve()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    UPDATE procurements.ppmps
       SET indicative_final = 'final',
           current_version  = NEW.version_number,
           updated_at       = NOW()
     WHERE id = NEW.ppmp_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_ppmp_on_version_approve
  AFTER UPDATE ON procurements.ppmp_versions
  FOR EACH ROW
  EXECUTE FUNCTION procurements.sync_ppmp_on_version_approve();

-- ============================================================
-- Trigger 4: Auto-populate APP from approved PPMP projects/lots
-- Fires AFTER UPDATE on ppmps when status → 'approved'.
-- Inserts approved PPMP lots into the APP's current draft
-- version. If the app_items table (Phase 6) does not yet
-- exist, the trigger returns gracefully without error.
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

  -- Skip if app_items table doesn't exist yet (Phase 6 adds it)
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'procurements'
       AND table_name   = 'app_items'
  ) THEN
    RETURN NEW;
  END IF;

  -- Locate the APP for this division + fiscal year
  SELECT id INTO v_app_id
    FROM procurements.apps
   WHERE division_id    = NEW.division_id
     AND fiscal_year_id = NEW.fiscal_year_id
     AND deleted_at     IS NULL
   LIMIT 1;

  IF v_app_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_app_version_id
    FROM procurements.app_versions
   WHERE app_id  = v_app_id
     AND status  NOT IN ('final','approved')
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_app_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Insert approved PPMP projects/lots into app_items
  -- Each lot becomes an APP item row
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
    ROW_NUMBER() OVER (ORDER BY pp.project_number, pl.lot_number),
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

CREATE TRIGGER trg_auto_populate_app_from_ppmp
  AFTER UPDATE ON procurements.ppmps
  FOR EACH ROW
  EXECUTE FUNCTION procurements.auto_populate_app_from_ppmp();

-- ============================================================
-- Constraint: only one draft ppmp_version per ppmp at a time
-- ============================================================

CREATE UNIQUE INDEX idx_ppmp_versions_one_draft_per_ppmp
  ON procurements.ppmp_versions (ppmp_id)
  WHERE status = 'draft';
