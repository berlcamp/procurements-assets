-- Phase 5: PPMP triggers

-- ============================================================
-- Trigger 1: Block UPDATE on approved ppmp_versions
-- Approved versions are immutable; amendments create new versions.
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
-- Fires BEFORE UPDATE on ppmp_versions when status transitions
-- to 'approved'. Captures the version row + all its items.
-- Runs before trg_prevent_approved_ppmp_version_update because
-- the snapshot is written in the same UPDATE that sets approved.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.snapshot_approved_ppmp_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_items JSONB;
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    SELECT jsonb_agg(row_to_json(pi.*))
      INTO v_items
      FROM procurements.ppmp_items pi
     WHERE pi.ppmp_version_id = NEW.id
       AND pi.deleted_at      IS NULL;

    NEW.snapshot_data = jsonb_build_object(
      'version',        row_to_json(NEW.*),
      'items',          COALESCE(v_items, '[]'::jsonb),
      'snapshotted_at', NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

-- snapshot runs first (BEFORE, fires before the immutability guard)
CREATE TRIGGER trg_snapshot_approved_ppmp_version
  BEFORE UPDATE ON procurements.ppmp_versions
  FOR EACH ROW
  EXECUTE FUNCTION procurements.snapshot_approved_ppmp_version();

-- ============================================================
-- Trigger 3: Sync parent ppmps when a version is approved
-- Sets indicative_final = 'final' and current_version on the
-- parent ppmps row after a version transitions to 'approved'.
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
-- Trigger 4: Auto-populate APP items when PPMP is approved
-- Fires AFTER UPDATE on ppmps when status → 'approved'.
-- Inserts approved PPMP items into the APP's current draft
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
  -- Only fire on PPMP status transition to 'approved'
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

  -- APP not created yet — skip gracefully (Phase 6 will wire this)
  IF v_app_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find the current open APP version (not yet final/approved)
  SELECT id INTO v_app_version_id
    FROM procurements.app_versions
   WHERE app_id  = v_app_id
     AND status  NOT IN ('final','approved')
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_app_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Insert approved PPMP items into app_items
  INSERT INTO procurements.app_items (
    app_version_id,
    app_id,
    source_ppmp_item_id,
    source_ppmp_id,
    item_number,
    category,
    description,
    unit,
    quantity,
    estimated_unit_cost,
    estimated_total_cost,
    procurement_method,
    budget_allocation_id,
    schedule_q1,
    schedule_q2,
    schedule_q3,
    schedule_q4,
    is_cse,
    source_office_id,
    remarks,
    hope_review_status,
    created_by
  )
  SELECT
    v_app_version_id,
    v_app_id,
    pi.id,
    pi.ppmp_id,
    pi.item_number,
    pi.category,
    pi.description,
    pi.unit,
    pi.quantity,
    pi.estimated_unit_cost,
    pi.estimated_total_cost,
    pi.procurement_method,
    pi.budget_allocation_id,
    pi.schedule_q1,
    pi.schedule_q2,
    pi.schedule_q3,
    pi.schedule_q4,
    pi.is_cse,
    pi.office_id,
    pi.remarks,
    'pending',
    pi.created_by
  FROM procurements.ppmp_items pi
  JOIN procurements.ppmp_versions pv ON pv.id = pi.ppmp_version_id
  WHERE pv.ppmp_id   = NEW.id
    AND pv.status    = 'approved'
    AND pi.deleted_at IS NULL;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_populate_app_from_ppmp
  AFTER UPDATE ON procurements.ppmps
  FOR EACH ROW
  EXECUTE FUNCTION procurements.auto_populate_app_from_ppmp();

-- ============================================================
-- Constraint: only one draft ppmp_version per ppmp at a time
-- Enforced via partial unique index.
-- ============================================================

CREATE UNIQUE INDEX idx_ppmp_versions_one_draft_per_ppmp
  ON procurements.ppmp_versions (ppmp_id)
  WHERE status = 'draft';
