-- ============================================================
-- APP item provenance and stable item numbering.
--
-- 1. source_ppmp_version_id anchors provenance to an immutable,
--    snapshotted version instead of to a mutable ppmp_lots row.
-- 2. A partial unique index makes duplicate item_numbers impossible.
-- 3. create_app_amendment re-maps lots by provenance, not by the
--    display number, so a renumber can never move money between lots.
-- ============================================================

ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS source_ppmp_version_id UUID
    REFERENCES procurements.ppmp_versions(id);

COMMENT ON COLUMN procurements.app_items.source_ppmp_version_id IS
  'Immutable provenance: the approved PPMP version this APP item was consolidated from.';

CREATE INDEX IF NOT EXISTS idx_app_items_source_version
  ON procurements.app_items(source_ppmp_version_id);

-- ADDED 2026-07-30 — third occurrence of this defect class in this plan.
-- Task 7 installed trg_app_items_immutable_when_locked, which raises on ANY
-- write to an app_item whose owning version is outside
-- ('draft','under_review','bac_finalization'). That trigger is now APPLIED on
-- the live database. All three backfills below touch items under final,
-- approved, and superseded versions, so without this suspension they abort with
-- "Cannot modify APP items on a version with status ...".
--
-- These backfills write only derived provenance and a display sequence number
-- — source_ppmp_version_id, which this migration introduces, and item_number,
-- which is a label rather than plan content. No money, quantity, description,
-- or review state is touched.
--
-- ALTER TABLE ... DISABLE TRIGGER is transactional, so a failure restores the
-- guard. Do NOT use SET session_replication_role — it would also disable the
-- audit trigger, and these writes must be audit-logged.
ALTER TABLE procurements.app_items
  DISABLE TRIGGER trg_app_items_immutable_when_locked;

-- Backfill via the lot -> project -> version chain.
UPDATE procurements.app_items ai
   SET source_ppmp_version_id = pp.ppmp_version_id
  FROM procurements.ppmp_projects pp
 WHERE ai.source_ppmp_project_id = pp.id
   AND ai.source_ppmp_version_id IS NULL;

-- Remaining rows have no project link: fall back to the PPMP's latest
-- approved version.
UPDATE procurements.app_items ai
   SET source_ppmp_version_id = (
     SELECT pv.id
       FROM procurements.ppmp_versions pv
      WHERE pv.ppmp_id = ai.source_ppmp_id
        AND pv.status  = 'approved'
      ORDER BY pv.version_number DESC
      LIMIT 1
   )
 WHERE ai.source_ppmp_version_id IS NULL
   AND ai.source_ppmp_id IS NOT NULL;

-- ============================================================
-- Renumber duplicates deterministically, then enforce uniqueness.
-- ============================================================

WITH renumbered AS (
  SELECT ai.id,
         ROW_NUMBER() OVER (
           PARTITION BY ai.app_version_id
           ORDER BY ai.source_ppmp_project_id,
                    ai.source_ppmp_lot_id,
                    ai.created_at,
                    ai.id
         ) AS new_number
    FROM procurements.app_items ai
   WHERE ai.deleted_at IS NULL
)
UPDATE procurements.app_items ai
   SET item_number = r.new_number
  FROM renumbered r
 WHERE r.id = ai.id
   AND ai.item_number <> r.new_number;

-- Restore the guard immediately, before the index is built. This migration's
-- verify script must assert tgenabled <> 'D' so a half-applied run cannot
-- leave app_items writable on locked versions.
ALTER TABLE procurements.app_items
  ENABLE TRIGGER trg_app_items_immutable_when_locked;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_items_unique_item_number
  ON procurements.app_items (app_version_id, item_number)
  WHERE deleted_at IS NULL;

-- ============================================================
-- Provenance-based lot re-mapping for amendments.
-- Replaces the item_number join at 20260405:320-331.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.remap_app_amendment_lots(
  p_old_version_id UUID,
  p_new_version_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE procurements.app_items new_ai
     SET lot_id          = new_lot.id,
         lot_item_number = old_ai.lot_item_number
    FROM procurements.app_items old_ai
    JOIN procurements.app_lots old_lot ON old_lot.id = old_ai.lot_id
    JOIN procurements.app_lots new_lot
      ON new_lot.app_version_id = p_new_version_id
     AND new_lot.lot_number     = old_lot.lot_number
   WHERE new_ai.app_version_id = p_new_version_id
     AND old_ai.app_version_id = p_old_version_id
     AND old_ai.deleted_at     IS NULL
     AND old_ai.lot_id         IS NOT NULL
     -- Provenance match, never display-number match:
     AND new_ai.source_ppmp_lot_id     IS NOT DISTINCT FROM old_ai.source_ppmp_lot_id
     AND new_ai.source_ppmp_version_id IS NOT DISTINCT FROM old_ai.source_ppmp_version_id
     AND new_ai.source_ppmp_lot_item_ids IS NOT DISTINCT FROM old_ai.source_ppmp_lot_item_ids;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION procurements.remap_app_amendment_lots(UUID, UUID) IS
  'Re-assigns cloned APP items to cloned lots by PPMP provenance. Never joins on item_number, which is a display value.';

-- ============================================================
-- create_app_amendment: copied verbatim from the live definition in
-- 20260803_stop_stage_writes_from_workflow.sql, with exactly three edits:
--   1. source_ppmp_version_id added to the item-clone INSERT column list
--      and SELECT list.
--   2. The item_number-join lot reassignment UPDATE (originally
--      20260405_ppmp_app_amendment_logic.sql:320-331) replaced with a call
--      to procurements.remap_app_amendment_lots(), which matches by
--      provenance instead of display number.
--   3. Task 4's edits are carried over unchanged: indicative_final is not
--      part of the app_versions INSERT, and apps.status is set to
--      'under_review' (not 'indicative').
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
    total_estimated_cost, status, created_by
  ) VALUES (
    p_app_id, v_next_version, 'amendment', p_justification,
    v_approved_ver.total_estimated_cost, 'draft', auth.uid()
  )
  RETURNING id INTO v_new_version_id;

  -- Clone items (carry forward all fields including new ones)
  --
  -- IMPORTANT: this INSERT/SELECT column list is a manual enumeration, not
  -- SELECT *. 20260729_app_item_line_level_lotting.sql added
  -- source_ppmp_lot_item_ids and 20260519_indicative_final_budget_tracking.sql
  -- (indicative_budget, budget_adjusted_by, budget_adjusted_at) both added
  -- columns to app_items without updating this function, so every APP
  -- amendment silently dropped those four columns from the cloned item.
  -- remap_app_amendment_lots() matches on source_ppmp_lot_item_ids, so
  -- without it the remap cannot work for split-lot rows, and dropping
  -- indicative_budget/budget_adjusted_by/budget_adjusted_at defeats the
  -- indicative-vs-final budget comparison and its audit trail. ANY future
  -- column added to app_items MUST also be added here, in both the INSERT
  -- column list and the SELECT list, in the same position.
  INSERT INTO procurements.app_items (
    app_version_id, app_id,
    source_ppmp_project_id, source_ppmp_lot_id, source_ppmp_id,
    source_ppmp_version_id,
    item_number, general_description, project_type,
    procurement_mode, estimated_budget, source_of_funds,
    procurement_start, procurement_end, delivery_period,
    budget_allocation_id, source_office_id,
    hope_review_status, hope_reviewed_by, hope_reviewed_at, hope_remarks,
    remarks, created_by,
    -- New fields
    source_ppmp_project_description, is_cse,
    schedule_quarter, advertisement_date, bid_opening_date,
    award_date, contract_signing_date,
    -- Previously dropped by this clone (see comment above); restored here.
    source_ppmp_lot_item_ids,
    indicative_budget, budget_adjusted_by, budget_adjusted_at
  )
  SELECT
    v_new_version_id, app_id,
    source_ppmp_project_id, source_ppmp_lot_id, source_ppmp_id,
    source_ppmp_version_id,
    item_number, general_description, project_type,
    procurement_mode, estimated_budget, source_of_funds,
    procurement_start, procurement_end, delivery_period,
    budget_allocation_id, source_office_id,
    hope_review_status, hope_reviewed_by, hope_reviewed_at, hope_remarks,
    remarks, created_by,
    -- New fields
    source_ppmp_project_description, is_cse,
    schedule_quarter, advertisement_date, bid_opening_date,
    award_date, contract_signing_date,
    -- Previously dropped by this clone (see comment above); restored here.
    source_ppmp_lot_item_ids,
    indicative_budget, budget_adjusted_by, budget_adjusted_at
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

  -- Reassign cloned items to their corresponding cloned lots by PPMP
  -- provenance, never by the display item_number.
  PERFORM procurements.remap_app_amendment_lots(v_approved_ver.id, v_new_version_id);

  -- Update parent APP
  UPDATE procurements.apps
     SET current_version = v_next_version,
         status          = 'under_review',
         updated_at      = NOW()
   WHERE id = p_app_id;

  RETURN v_new_version_id;
END;
$$;
