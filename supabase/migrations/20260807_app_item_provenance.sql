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

-- ADDED 2026-07-30 — FOURTH occurrence of this defect class in this plan.
-- Two triggers on app_items must be suspended for the backfills below, one
-- directly and one indirectly. The indirect one is what the three earlier
-- audits missed: it is not a guard on THIS table, it is an ordinary trigger on
-- this table that cascades a write into ANOTHER table which carries a guard.
-- Grepping app_items for guards does not find it. When suspending a guard for
-- a backfill, the check must be "what writes does my UPDATE ultimately cause",
-- not "what guards sit on the table I am updating".
--
-- (1) trg_app_items_immutable_when_locked — DIRECT.
--     Task 7 installed it and it is now APPLIED on the live database. It
--     raises on ANY write to an app_item whose owning version is outside
--     ('draft','under_review','bac_finalization'). All three backfills below
--     touch items under final, approved, and superseded versions, so without
--     this suspension they abort with "Cannot modify APP items on a version
--     with status ...".
--
-- (2) trg_recalc_app_version_total — INDIRECT.
--     20240604_app_triggers.sql:73-76 declares it AFTER INSERT OR UPDATE OR
--     DELETE ... FOR EACH ROW, with no WHEN clause and no column list, so it
--     fires for every row all three backfills touch. Its body unconditionally
--     issues "UPDATE procurements.app_versions SET total_estimated_cost = ...",
--     and that write trips trg_prevent_approved_app_version_update
--     (20260806_app_content_immutability.sql:160-178, also already applied),
--     which raises whenever OLD.status = 'approved' AND NEW.status =
--     'approved'. Postgres does not skip no-op UPDATEs, so the guard fires even
--     though the recomputed total is byte-identical. Without this suspension
--     the very first app_item under any approved app_version aborts the whole
--     migration.
--
--     Suppressing the recalc is provably safe here: its only inputs are
--     SUM(estimated_budget) over rows filtered by app_version_id and
--     deleted_at IS NULL. None of the three backfills writes estimated_budget,
--     app_version_id, or deleted_at, so every recalc it would perform is a
--     no-op and no total can drift as a result of skipping them.
--
-- The third trigger on app_items, trg_update_app_status_on_item_insert
-- (20240604:38), is AFTER INSERT only and cannot fire for an UPDATE, so it is
-- deliberately left enabled.
--
-- These backfills write only derived provenance and a display sequence number
-- — source_ppmp_version_id, which this migration introduces, and item_number,
-- which is a label rather than plan content. No money, quantity, description,
-- or review state is touched.
--
-- ALTER TABLE ... DISABLE TRIGGER is transactional, so a failure restores both
-- triggers. Do NOT use SET session_replication_role: it is session-wide, so it
-- would silently suspend every trigger on every table this transaction touches
-- — including FK enforcement triggers and guards nothing here has reasoned
-- about — rather than the two named below. (It would NOT skip an audit trigger
-- on app_items: there is none. No app_* table carries one; audit triggers on
-- this project are attached individually, e.g. 20240314_triggers.sql:97-111.)
ALTER TABLE procurements.app_items
  DISABLE TRIGGER trg_app_items_immutable_when_locked,
  DISABLE TRIGGER trg_recalc_app_version_total;

-- Backfill via the lot -> project -> version chain.
UPDATE procurements.app_items ai
   SET source_ppmp_version_id = pp.ppmp_version_id
  FROM procurements.ppmp_projects pp
 WHERE ai.source_ppmp_project_id = pp.id
   AND ai.source_ppmp_version_id IS NULL;

-- Remaining rows have no project link. Fall back to the PPMP version that was
-- the latest APPROVED ONE AT THE MOMENT THE ITEM WAS CREATED — not the latest
-- approved version as of today.
--
-- The distinction is the whole point of the column. This is "immutable
-- provenance" (see the COMMENT above), so it must name a version that actually
-- existed when the consolidation happened. Without the approved_at predicate,
-- an item consolidated in March from approved version 1, on a PPMP amended
-- twice since, gets stamped version 3 — a version that did not exist on the day
-- the item was created. Stamping a guess and labelling it immutable is strictly
-- worse than leaving it NULL: NULL is legible as "unknown", a wrong UUID is not.
-- Task 3 set this precedent when it replaced a present-day-state backfill with
-- the date-aware ceiling_id_as_of.
--
-- NULL is the CORRECT and intended outcome when nothing qualifies — an item
-- created before its PPMP had any approved version, or one whose source PPMP
-- was deleted. The scalar subquery returns NULL and the row is simply left
-- unstamped for a human to resolve.
--
-- ppmp_versions.approved_at (20240501_ppmps.sql:63) is NULLABLE, though every
-- approval path sets it alongside status (20240503_ppmp_rpc.sql:307-310,
-- 20260803_stop_stage_writes_from_workflow.sql:52-55). DELIBERATE CHOICE: a row
-- with status='approved' and approved_at IS NULL does NOT qualify — the
-- comparison yields NULL, the row is excluded, and provenance stays NULL. We
-- prefer that over COALESCE'ing to created_at, because an approved version with
-- no approval timestamp is corrupt data whose true approval date is unknown,
-- and inventing one would reintroduce exactly the guess this fix removes.
UPDATE procurements.app_items ai
   SET source_ppmp_version_id = (
     SELECT pv.id
       FROM procurements.ppmp_versions pv
      WHERE pv.ppmp_id = ai.source_ppmp_id
        AND pv.status  = 'approved'
        -- Date-aware: only versions already approved when the item was made.
        AND pv.approved_at <= ai.created_at
      ORDER BY pv.approved_at DESC, pv.version_number DESC
      LIMIT 1
   )
 WHERE ai.source_ppmp_version_id IS NULL
   AND ai.source_ppmp_id IS NOT NULL;

-- ============================================================
-- Renumber duplicates deterministically, then enforce uniqueness.
-- ============================================================

-- The ORDER BY MUST lead with ai.item_number, i.e. it must preserve the
-- EXISTING display order and break only genuine ties. Do NOT "improve" this
-- into a semantic sort (by project, by lot, by description, ...).
--
-- Two reasons, both hard:
--
-- 1. ROW_NUMBER() is computed over EVERY row of EVERY partition, not only the
--    duplicated ones. The "AND ai.item_number <> r.new_number" predicate limits
--    which rows are WRITTEN, but any ordering that disagrees with the current
--    sequence permutes the whole version.
--
-- 2. trg_snapshot_approved_app_version (20240604_app_triggers.sql:117-120)
--    stores row_to_json of every item — item_number included — into the
--    approved version's snapshot_data. That JSONB is the legal record of what
--    was approved, and posted APPs have already been published to PhilGEPS.
--    Renumbering a live item away from its snapshot desynchronises the record
--    from the plan it certifies, and there is no audit trigger on app_items to
--    reconstruct what changed.
--
-- The previous ordering led with ai.source_ppmp_project_id and
-- ai.source_ppmp_lot_id. Both are gen_random_uuid() surrogates
-- (20240505_ppmp_restructure.sql:60 and :83) — sorting by a random v4 UUID is
-- not an ordering, it is a shuffle, and it permuted every APP version in the
-- system, duplicated or not. created_at then id remain as tie-breakers, so the
-- result stays fully deterministic where item_number really is duplicated.
--
-- Ordering by item_number is NECESSARY but NOT SUFFICIENT to leave clean
-- versions untouched, because ROW_NUMBER() also CLOSES GAPS. app_items are
-- soft-deleted in normal operation — merge_app_lot_items sets deleted_at when
-- it absorbs one line item into another (20260729:229-232) — and this CTE
-- filters deleted_at IS NULL, so a version whose live items are numbered
-- 1,2,4,5 has no duplicates yet still gets densified to 1,2,3,4, writing two
-- rows. On an approved or posted version that is the very snapshot
-- desynchronisation described above, just on fewer rows.
--
-- So the renumber is additionally SCOPED to versions that actually contain a
-- duplicate. A version with no duplicate already satisfies the unique index
-- being created below, gaps or not — the index constrains uniqueness, not
-- contiguity — so touching it buys nothing and risks the legal record. This
-- makes the guarantee real: every version without a duplicate comes out
-- byte-identical and the UPDATE touches zero of its rows.
WITH dupe_versions AS (
  SELECT ai.app_version_id
    FROM procurements.app_items ai
   WHERE ai.deleted_at IS NULL
   GROUP BY ai.app_version_id, ai.item_number
  HAVING COUNT(*) > 1
),
renumbered AS (
  SELECT ai.id,
         ROW_NUMBER() OVER (
           PARTITION BY ai.app_version_id
           ORDER BY ai.item_number,
                    ai.created_at,
                    ai.id
         ) AS new_number
    FROM procurements.app_items ai
   WHERE ai.deleted_at IS NULL
     AND ai.app_version_id IN (SELECT app_version_id FROM dupe_versions)
)
UPDATE procurements.app_items ai
   SET item_number = r.new_number
  FROM renumbered r
 WHERE r.id = ai.id
   AND ai.item_number <> r.new_number;

-- Restore BOTH triggers immediately, before the index is built. This list must
-- stay 1:1 with the DISABLE list above. This migration's verify script asserts
-- tgenabled <> 'D' for both, so a half-applied run cannot leave app_items
-- writable on locked versions or leave version totals unmaintained.
ALTER TABLE procurements.app_items
  ENABLE TRIGGER trg_app_items_immutable_when_locked,
  ENABLE TRIGGER trg_recalc_app_version_total;

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
  'Re-assigns cloned APP items to cloned lots by PPMP provenance. Never joins on item_number, which is a display value. INTERNAL: called only by create_app_amendment; EXECUTE is revoked from PUBLIC.';

-- This is an INTERNAL HELPER, not an API. Postgres grants EXECUTE TO PUBLIC on
-- every new function by default, and the procurements schema is exposed over
-- PostgREST (the app calls supabase.schema("procurements").rpc(...) in ~10
-- places), so without this REVOKE the function is a live REST endpoint for any
-- authenticated user. It is SECURITY DEFINER, so it bypasses RLS, and it
-- carries no authorisation check of its own — no division check, no permission
-- check. Intra-division, any end_user able to read APP versions could call it
-- to reassign items between BAC lots on a draft or under-review version,
-- bypassing the app.bac_manage_lots permission that the comparable public RPC
-- assign_lot_items_to_lot enforces
-- (20260729_app_item_line_level_lotting.sql:290-303).
--
-- No authorisation check is added here instead, because the only caller is
-- create_app_amendment, which already verifies division ownership, the
-- app.amend permission, and the APP's status before calling. That caller is
-- itself SECURITY DEFINER, so it executes as the function owner and retains
-- EXECUTE on this helper regardless of what PUBLIC holds.
--
-- Any future caller reached directly from the client MUST be granted
-- explicitly, and MUST do its own authorisation first.
REVOKE EXECUTE ON FUNCTION procurements.remap_app_amendment_lots(UUID, UUID) FROM PUBLIC;

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
