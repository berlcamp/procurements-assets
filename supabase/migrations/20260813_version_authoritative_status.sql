-- ============================================================
-- The version is authoritative; the parent is a summary.
--
-- Resetting ppmps.status to 'draft' when an amendment opens destroyed the fact
-- that an approved version exists and remains operative. With Phase 4 in place,
-- procurement can legitimately run against that approved version while the next
-- one is being drafted.
-- ============================================================

BEGIN;

ALTER TABLE procurements.ppmps
  ADD COLUMN IF NOT EXISTS has_open_amendment BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN procurements.ppmps.has_open_amendment IS
  'True while a draft amendment version exists. The parent status keeps reflecting the last approved version.';

-- Backfill 1: any PPMP with a draft version alongside an approved one.
--
-- P2 SAFE. This writes only has_open_amendment, never status, so
-- trg_auto_populate_app_from_ppmp short-circuits in both directions on its
-- OLD.status = NEW.status guard, and trg_sync_planning_round_office_status
-- (AFTER UPDATE OF status) cannot fire at all.
UPDATE procurements.ppmps p
   SET has_open_amendment = true
 WHERE EXISTS (
   SELECT 1 FROM procurements.ppmp_versions pv
    WHERE pv.ppmp_id = p.id AND pv.status = 'draft'
 )
 AND EXISTS (
   SELECT 1 FROM procurements.ppmp_versions pv
    WHERE pv.ppmp_id = p.id AND pv.status = 'approved'
 );

-- ============================================================
-- Backfill 2: repair parents that were wrongly knocked back to draft.
--
-- *** THIS ONE WRITES ppmps.status AND IS THE DANGEROUS ONE. ***
--
-- trg_auto_populate_app_from_ppmp is AFTER UPDATE ON ppmps FOR EACH ROW with NO
-- WHEN CLAUSE. Its only protection is an internal guard:
--     IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN RETURN NEW;
-- This backfill moves status from 'draft' to 'approved', so NEITHER disjunct is
-- true and the guard DOES NOT short-circuit. Left enabled, every repaired row
-- would run a full APP consolidation inside this migration: soft-deleting and
-- re-inserting app_items, possibly creating supplemental APP versions, flipping
-- apps.status back to 'indicative', writing consolidation markers and fanning
-- out notifications -- and very likely aborting outright against the 20260806
-- guards on approved app_versions.
--
-- trg_sync_planning_round_office_status (20260812) would also fire and record a
-- migration repair as though an office had filed its revision.
--
-- Both are suspended for exactly this statement and restored immediately. The
-- verify script asserts both are re-enabled, because a migration that leaves a
-- guard disabled is worse than one that fails.
-- ============================================================

ALTER TABLE procurements.ppmps DISABLE TRIGGER trg_auto_populate_app_from_ppmp;
ALTER TABLE procurements.ppmps DISABLE TRIGGER trg_sync_planning_round_office_status;

UPDATE procurements.ppmps p
   SET status = 'approved'
 WHERE p.status = 'draft'
   AND p.has_open_amendment = true
   AND EXISTS (
     SELECT 1 FROM procurements.ppmp_versions pv
      WHERE pv.ppmp_id = p.id AND pv.status = 'approved'
   );

ALTER TABLE procurements.ppmps ENABLE TRIGGER trg_sync_planning_round_office_status;
ALTER TABLE procurements.ppmps ENABLE TRIGGER trg_auto_populate_app_from_ppmp;

-- ============================================================
-- Single place to read a PPMP's real state.
-- ============================================================

CREATE OR REPLACE VIEW procurements.v_ppmp_current_state
WITH (security_invoker = true) AS
SELECT
  p.id                        AS ppmp_id,
  p.division_id,
  p.office_id,
  p.fiscal_year_id,
  p.status                    AS document_status,
  p.consolidation_status,
  p.has_open_amendment,

  -- The operative approved version
  av.id                       AS approved_version_id,
  av.version_number           AS approved_version_number,
  av.planning_stage           AS approved_planning_stage,
  av.total_estimated_budget   AS approved_total,
  av.approved_at,

  -- The in-progress version, if any
  dv.id                       AS draft_version_id,
  dv.version_number           AS draft_version_number,
  dv.planning_stage           AS draft_planning_stage,
  dv.total_estimated_budget   AS draft_total
FROM procurements.ppmps p
LEFT JOIN LATERAL (
  SELECT * FROM procurements.ppmp_versions
   WHERE ppmp_id = p.id AND status = 'approved'
   ORDER BY version_number DESC
   LIMIT 1
) av ON true
LEFT JOIN LATERAL (
  SELECT * FROM procurements.ppmp_versions
   WHERE ppmp_id = p.id AND status NOT IN ('approved','superseded')
   ORDER BY version_number DESC
   LIMIT 1
) dv ON true
WHERE p.deleted_at IS NULL;

COMMENT ON VIEW procurements.v_ppmp_current_state IS
  'Authoritative read model: the operative approved version and any in-progress version, side by side. security_invoker so the caller''s RLS applies -- a plain view would run as its owner and leak across divisions.';

GRANT SELECT ON procurements.v_ppmp_current_state TO authenticated;

-- ============================================================
-- Keep has_open_amendment accurate.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.sync_ppmp_open_amendment_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ids UUID[];
  v_id  UUID;
BEGIN
  -- P1. The plan wrote COALESCE(NEW.ppmp_id, OLD.ppmp_id), which on UPDATE
  -- always yields NEW and would leave the OLD parent's flag stale if a version
  -- were ever reparented. Collect BOTH sides and recompute each; the array form
  -- also makes the INSERT/DELETE cases explicit rather than implied.
  v_ids := ARRAY(
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.ppmp_id END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.ppmp_id END
    ]) AS x WHERE x IS NOT NULL
  );

  FOREACH v_id IN ARRAY v_ids LOOP
    -- Writes only has_open_amendment/updated_at, never status. So the cascade
    -- into ppmps cannot wake trg_auto_populate_app_from_ppmp (OLD.status =
    -- NEW.status makes its guard short-circuit either way) and cannot fire
    -- trg_sync_planning_round_office_status, which is AFTER UPDATE OF status.
    UPDATE procurements.ppmps p
       SET has_open_amendment = EXISTS (
             SELECT 1 FROM procurements.ppmp_versions pv
              WHERE pv.ppmp_id = v_id
                AND pv.status NOT IN ('approved','superseded')
           ),
           updated_at = NOW()
     WHERE p.id = v_id;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_ppmp_open_amendment_flag ON procurements.ppmp_versions;
CREATE TRIGGER trg_sync_ppmp_open_amendment_flag
  AFTER INSERT OR UPDATE OF status OR DELETE ON procurements.ppmp_versions
  FOR EACH ROW EXECUTE FUNCTION procurements.sync_ppmp_open_amendment_flag();

-- ============================================================
-- create_ppmp_amendment: stop resetting the parent to 'draft'.
-- Body is the LIVE definition (20260809_amendment_guards.sql), with only the
-- closing parent UPDATE changed.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.create_ppmp_amendment(p_ppmp_id uuid, p_justification text, p_force boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'procurements', 'platform', 'auth', 'public'
AS $function$
DECLARE
  v_ppmp            RECORD;
  v_approved_ver    RECORD;
  v_next_version    INTEGER;
  v_new_version_id  UUID;
  v_proj_rec        RECORD;
  v_new_project_id  UUID;
  v_lot_rec         RECORD;
  v_new_lot_id      UUID;
  v_inflight_count  INTEGER;
  v_actor           UUID;
BEGIN
  SELECT *
    INTO v_ppmp
    FROM procurements.ppmps
   WHERE id          = p_ppmp_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  IF v_ppmp.created_by <> auth.uid()
    AND NOT procurements.has_permission('ppmp.amend')
  THEN
    RAISE EXCEPTION 'Insufficient permissions to amend PPMP %', p_ppmp_id;
  END IF;

  IF v_ppmp.status NOT IN ('approved', 'locked') THEN
    RAISE EXCEPTION 'Only approved or locked PPMPs can be amended (current status: %)', v_ppmp.status;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_versions
     WHERE ppmp_id = p_ppmp_id
       AND status  = 'draft'
  ) THEN
    RAISE EXCEPTION 'An amendment is already in progress for PPMP %. Finish or discard it first.', p_ppmp_id;
  END IF;

  -- ----------------------------------------------------------------------
  -- IN-FLIGHT PROCUREMENT GUARD (new in 20260809).
  --
  -- Approving this amendment fires auto_populate_app_from_ppmp, which
  -- soft-deletes every app_item with source_ppmp_id = this PPMP, in the
  -- version it is editing (20260405_ppmp_app_amendment_logic.sql:166-172).
  -- Because that is a SOFT delete the foreign keys still resolve, so
  -- pr_items.app_item_id keeps pointing at a row the APP no longer shows, and
  -- a lot already released to bidding keeps a line whose ABC the amendment may
  -- have changed. Nothing downstream notices.
  -- (purchase_requests.app_item_id is not in play; that column was dropped by
  -- 20260413_pr_bundling_step3_drop_legacy.sql:369.)
  --
  -- Counted once into a variable rather than calling the helper for both the
  -- EXISTS test and the message: the plan's form evaluated the set-returning
  -- function three times per blocked call.
  --
  -- COUNT(DISTINCT app_item_id), not COUNT(*). The helper's two arms are
  -- UNION ALL, so one APP item both sitting in a finalized lot and referenced
  -- by two live PRs returns three rows. COUNT(*) would tell the user "3 of its
  -- APP items are already in procurement" when there is one, and would write
  -- that inflated number into the approval_logs remark below -- a COA-facing
  -- audit record. One row per reason is the right RETURN shape for the helper;
  -- it is the wrong number to show a human.
  -- ----------------------------------------------------------------------
  SELECT COUNT(DISTINCT app_item_id)
    INTO v_inflight_count
    FROM procurements.ppmp_has_inflight_procurement(p_ppmp_id);

  IF v_inflight_count > 0 THEN
    IF NOT p_force THEN
      -- Adjacent string literals separated by a newline are concatenated by
      -- the lexer into ONE literal before RAISE ever sees them; verified on
      -- PostgreSQL 18. Three % placeholders, three arguments.
      --
      -- The UUID is wrapped in DOUBLED single quotes, NOT written as %L.
      -- RAISE's format string supports only % and %%; it is not format(), so
      -- %L emits the value followed by a stray literal 'L' and no quoting,
      -- producing invalid SQL in the very command this message tells the
      -- user to run. Confirmed by execution before this was written.
      RAISE EXCEPTION
        'Cannot amend PPMP %: % of its APP items are already in procurement. '
        'Review them with: SELECT * FROM procurements.ppmp_has_inflight_procurement(''%''); '
        'then cancel those activities or re-run with p_force := true '
        '(requires the ppmp.amend_override permission).',
        p_ppmp_id, v_inflight_count, p_ppmp_id;
    END IF;

    IF NOT procurements.has_permission('ppmp.amend_override') THEN
      RAISE EXCEPTION
        'Forcing an amendment past in-flight procurement requires the ppmp.amend_override permission.';
    END IF;

    -- approval_logs.acted_by is NOT NULL (20240311_approval_logs.sql:9) and
    -- auth.uid() is NULL without a JWT. The lookup at the top of this
    -- function already makes that unreachable -- ppmps.division_id is NOT
    -- NULL, so `division_id = procurements.get_user_division_id()` can never
    -- be true once get_user_division_id() returns NULL, and the function
    -- exits with 'not found or access denied' long before here. This check
    -- exists so that if that gate is ever loosened, the failure is this
    -- sentence and not a bare not-null violation on an audit table.
    v_actor := auth.uid();
    IF v_actor IS NULL THEN
      RAISE EXCEPTION
        'Cannot force an amendment without an authenticated user (auth.uid() is NULL).';
    END IF;

    -- action = 'noted' is in the approval_logs CHECK set
    -- ('approved','rejected','returned','forwarded','noted').
    -- v_ppmp is the record SELECTed at the top of this function and
    -- procurements.ppmps.office_id is NOT NULL, so v_ppmp.office_id is in
    -- scope and populated here.
    INSERT INTO procurements.approval_logs (
      reference_type, reference_id, step_name, step_order,
      action, acted_by, remarks, office_id
    ) VALUES (
      'ppmp', p_ppmp_id, 'Amendment Override', 6,
      'noted', v_actor,
      'Amendment forced past in-flight procurement ('
        || v_inflight_count || ' item(s) affected). Justification: '
        || COALESCE(p_justification, '(none)'),
      v_ppmp.office_id
    );
  END IF;

  SELECT *
    INTO v_approved_ver
    FROM procurements.ppmp_versions
   WHERE ppmp_id = p_ppmp_id
     AND status  = 'approved'
   ORDER BY version_number DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No approved version found for PPMP % to base amendment on', p_ppmp_id;
  END IF;

  v_next_version := v_ppmp.current_version + 1;

  INSERT INTO procurements.ppmp_versions (
    ppmp_id, version_number, version_type, amendment_justification,
    total_estimated_budget, status, office_id, created_by
  ) VALUES (
    p_ppmp_id, v_next_version, 'amendment', p_justification,
    v_approved_ver.total_estimated_budget, 'draft',
    v_approved_ver.office_id, auth.uid()
  )
  RETURNING id INTO v_new_version_id;

  -- Clone projects → lots → items
  FOR v_proj_rec IN
    SELECT * FROM procurements.ppmp_projects
     WHERE ppmp_version_id = v_approved_ver.id
       AND deleted_at      IS NULL
  LOOP
    INSERT INTO procurements.ppmp_projects (
      ppmp_version_id, ppmp_id, project_number,
      general_description, project_type, office_id, created_by
    ) VALUES (
      v_new_version_id, v_proj_rec.ppmp_id, v_proj_rec.project_number,
      v_proj_rec.general_description, v_proj_rec.project_type,
      v_proj_rec.office_id, auth.uid()
    )
    RETURNING id INTO v_new_project_id;

    FOR v_lot_rec IN
      SELECT * FROM procurements.ppmp_lots
       WHERE ppmp_project_id = v_proj_rec.id
    LOOP
      -- ------------------------------------------------------------------
      -- MANUAL COLUMN ENUMERATION -- BUG P-1, FIXED HERE.
      --
      -- procurements.ppmp_lots has 22 columns: 16 from
      -- 20240501_ppmps.sql:109-136 plus 6 from
      -- 20260516_app_cse_schedule_columns.sql:25,34.
      -- (Not 20240505_ppmp_restructure.sql:82-109, which carries a
      -- byte-identical CREATE TABLE IF NOT EXISTS that no-ops: 20240501 has
      -- already created the table by then. Verified identical line for line.)
      -- (20260517_unify_procurement_modes.sql:59 adds a CHECK constraint,
      -- not a column. The table has NO deleted_at, which is why the FOR loop
      -- above correctly has no `deleted_at IS NULL` filter.)
      --
      -- Until now this clone listed 13 of them. 20260516 added its six
      -- columns and did NOT update this list, so every amendment silently
      -- reset is_cse to its NOT NULL DEFAULT false -- reclassifying every
      -- Common-Use Supplies lot as non-CSE -- and blanked schedule_quarter
      -- and all four GPPB schedule dates. It then propagated: the amended
      -- PPMP re-populates the APP through auto_populate_app_from_ppmp, which
      -- reads ALL SIX of them off ppmp_lots -- pl.is_cse, pl.schedule_quarter,
      -- pl.advertisement_date, pl.bid_opening_date, pl.award_date and
      -- pl.contract_signing_date (20260516_app_cse_schedule_columns.sql:
      -- 246-248) -- straight into the corresponding app_items columns. The
      -- blast radius was every one of the six, not just the first two.
      --
      -- Not cloned, and why: id (identity, generated); created_at/updated_at
      -- (new row's own timestamps, DEFAULT NOW()); ppmp_project_id (rebound
      -- to v_new_project_id, the clone of the parent project).
      -- That is 19 cloned + 3 defaulted + 1 rebound = 22.
      --
      -- The INSERT list and the VALUES list are POSITIONAL. They must stay
      -- the same length and the same order; `INSERT (a,b) VALUES (y,x)` is
      -- valid SQL that writes wrong data forever. Note the two runs of
      -- interchangeable TEXT columns -- procurement_start/procurement_end/
      -- delivery_period/source_of_funds, and schedule_quarter/
      -- advertisement_date/bid_opening_date/award_date/
      -- contract_signing_date -- where a transposition would never be caught
      -- by the type system.
      --
      -- ANY future ALTER TABLE ... ADD COLUMN on procurements.ppmp_lots must
      -- be added to BOTH lists below, in the SAME position.
      -- ------------------------------------------------------------------
      INSERT INTO procurements.ppmp_lots (
        ppmp_project_id, lot_number, lot_title, procurement_mode,
        pre_procurement_conference, procurement_start, procurement_end,
        delivery_period, source_of_funds, estimated_budget,
        supporting_documents, remarks, budget_allocation_id,
        is_cse, schedule_quarter, advertisement_date,
        bid_opening_date, award_date, contract_signing_date
      ) VALUES (
        v_new_project_id, v_lot_rec.lot_number, v_lot_rec.lot_title,
        v_lot_rec.procurement_mode, v_lot_rec.pre_procurement_conference,
        v_lot_rec.procurement_start, v_lot_rec.procurement_end,
        v_lot_rec.delivery_period, v_lot_rec.source_of_funds,
        v_lot_rec.estimated_budget, v_lot_rec.supporting_documents,
        v_lot_rec.remarks, v_lot_rec.budget_allocation_id,
        v_lot_rec.is_cse, v_lot_rec.schedule_quarter,
        v_lot_rec.advertisement_date, v_lot_rec.bid_opening_date,
        v_lot_rec.award_date, v_lot_rec.contract_signing_date
      )
      RETURNING id INTO v_new_lot_id;

      INSERT INTO procurements.ppmp_lot_items (
        ppmp_lot_id, item_number, description, quantity, unit,
        specification, estimated_unit_cost
      )
      SELECT
        v_new_lot_id, item_number, description, quantity, unit,
        specification, estimated_unit_cost
      FROM procurements.ppmp_lot_items
      WHERE ppmp_lot_id = v_lot_rec.id;
    END LOOP;
  END LOOP;

  -- 20260813: advance the version pointer but KEEP the document's approved
  -- status. Resetting it to 'draft' destroyed the fact that an approved version
  -- exists and remains operative -- which matters now that Phase 4 lets
  -- procurement run against that approved version while the next one is drafted.
  -- has_open_amendment carries "a revision is in progress"; ppmps.status keeps
  -- describing the last APPROVED version. The trigger on ppmp_versions maintains
  -- the flag too; setting it here makes the intent explicit at the call site.
  UPDATE procurements.ppmps
     SET current_version    = v_next_version,
         has_open_amendment = true,
         updated_at         = NOW()
   WHERE id = p_ppmp_id;

  RETURN v_new_version_id;
END;
$function$;

-- ============================================================
-- submit_ppmp: validate the VERSION, not the parent document.
-- Body is the LIVE definition (20260606_ppmp_submit_allow_revision_required.sql
-- -- confirmed live, not the 20240503 original), with two edits.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.submit_ppmp(p_ppmp_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'procurements', 'platform', 'auth', 'public'
AS $function$
DECLARE
  v_ppmp          RECORD;
  v_project_count INTEGER;
  v_version_id    UUID;
  v_alloc_rec     RECORD;
BEGIN
  SELECT *
    INTO v_ppmp
    FROM procurements.ppmps
   WHERE id          = p_ppmp_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  IF v_ppmp.created_by <> auth.uid()
    AND NOT procurements.has_permission('ppmp.submit')
  THEN
    RAISE EXCEPTION 'Insufficient permissions to submit PPMP %', p_ppmp_id;
  END IF;

  -- Allow re-submission after a return (revision_required) in addition to
  -- the normal initial submission from draft.
  --
  -- 20260813: an OPEN AMENDMENT is now also submittable. create_ppmp_amendment
  -- no longer knocks the parent back to 'draft', so without this an amendment
  -- could be opened and then never submitted -- the parent still reads
  -- 'approved'. The authority moves to the VERSION, checked immediately below.
  IF v_ppmp.status NOT IN ('draft', 'revision_required')
     AND NOT COALESCE(v_ppmp.has_open_amendment, false) THEN
    RAISE EXCEPTION
      'Only draft PPMPs, returned PPMPs, or open amendments can be submitted (current status: %)',
      v_ppmp.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.ppmp_versions
   WHERE ppmp_id        = p_ppmp_id
     AND version_number = v_ppmp.current_version;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'No version found for PPMP % (version %)', p_ppmp_id, v_ppmp.current_version;
  END IF;

  -- THE VERSION IS THE AUTHORITY. The parent gate above is now permissive for
  -- an open amendment, so this is what actually stops a second submission of an
  -- already-submitted or already-approved version.
  IF (SELECT status FROM procurements.ppmp_versions WHERE id = v_version_id) <> 'draft' THEN
    RAISE EXCEPTION
      'The current PPMP version is not in draft and cannot be submitted (version %).',
      v_ppmp.current_version;
  END IF;

  -- At least one project must exist
  SELECT COUNT(*) INTO v_project_count
    FROM procurements.ppmp_projects
   WHERE ppmp_version_id = v_version_id
     AND deleted_at      IS NULL;

  IF v_project_count = 0 THEN
    RAISE EXCEPTION 'Cannot submit PPMP % — it has no procurement projects', p_ppmp_id;
  END IF;

  -- Every project must have at least one lot with at least one item
  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_projects pp
     WHERE pp.ppmp_version_id = v_version_id
       AND pp.deleted_at      IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM procurements.ppmp_lots pl
           JOIN procurements.ppmp_lot_items pli ON pli.ppmp_lot_id = pl.id
          WHERE pl.ppmp_project_id = pp.id
       )
  ) THEN
    RAISE EXCEPTION 'All procurement projects must have at least one lot with items';
  END IF;

  -- Every lot must have estimated_budget > 0
  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
     WHERE pp.ppmp_version_id = v_version_id
       AND pp.deleted_at      IS NULL
       AND pl.estimated_budget <= 0
  ) THEN
    RAISE EXCEPTION 'All lots must have an estimated budget greater than zero';
  END IF;

  -- Budget availability check
  FOR v_alloc_rec IN
    SELECT
      pl.budget_allocation_id,
      SUM(pl.estimated_budget) AS ppmp_total,
      ba.adjusted_amount,
      ba.obligated_amount
    FROM procurements.ppmp_lots pl
    JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
    JOIN procurements.budget_allocations ba ON ba.id = pl.budget_allocation_id
   WHERE pp.ppmp_version_id   = v_version_id
     AND pp.deleted_at        IS NULL
     AND pl.budget_allocation_id IS NOT NULL
   GROUP BY pl.budget_allocation_id, ba.adjusted_amount, ba.obligated_amount
  LOOP
    IF v_alloc_rec.ppmp_total > (v_alloc_rec.adjusted_amount - v_alloc_rec.obligated_amount) THEN
      RAISE EXCEPTION
        'PPMP lots for allocation % exceed available budget (PPMP total: %, available: %)',
        v_alloc_rec.budget_allocation_id,
        v_alloc_rec.ppmp_total,
        (v_alloc_rec.adjusted_amount - v_alloc_rec.obligated_amount);
    END IF;
  END LOOP;

  UPDATE procurements.ppmps
     SET status       = 'submitted',
         submitted_at = NOW(),
         submitted_by = auth.uid(),
         updated_at   = NOW()
   WHERE id = p_ppmp_id;

  UPDATE procurements.ppmp_versions
     SET status = 'submitted'
   WHERE id = v_version_id;
END;
$function$;

COMMIT;
