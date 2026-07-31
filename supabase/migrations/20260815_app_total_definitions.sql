-- ============================================================
-- Two totals, two names.
--
--   total_estimated_cost = every non-deleted item (what offices asked for)
--   total_approved_cost  = HOPE-approved items only (what goes on the APP)
--
-- Previously both meanings shared total_estimated_cost depending on which
-- routine wrote last: recalc_app_version_total summed everything, finalize_app
-- summed only approved rows into the SAME column. So the figure silently
-- changed meaning at finalization, and before it a user saw a total that
-- quietly included remarked rows.
-- ============================================================

BEGIN;

ALTER TABLE procurements.app_versions
  ADD COLUMN IF NOT EXISTS total_approved_cost NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN procurements.app_versions.total_estimated_cost IS
  'Sum of ALL non-deleted APP items, regardless of HOPE review outcome. What offices asked for.';
COMMENT ON COLUMN procurements.app_versions.total_approved_cost IS
  'Sum of HOPE-approved APP items only. The figure that goes on the APP document.';

-- ============================================================
-- Maintain both totals from app_items.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.recalc_app_version_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ids UUID[];
  v_id  UUID;
BEGIN
  -- P1. The previous body -- and the plan's replacement -- used
  -- COALESCE(NEW.app_version_id, OLD.app_version_id), which on UPDATE always
  -- yields NEW. app_items.app_version_id is NOT NULL but plainly updatable, and
  -- create_app_amendment moves items between versions, so the OLD version's
  -- totals would be left stale and overstated. Recompute BOTH sides.
  v_ids := ARRAY(
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.app_version_id END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.app_version_id END
    ]) AS x WHERE x IS NOT NULL
  );

  FOREACH v_id IN ARRAY v_ids LOOP
    UPDATE procurements.app_versions av
       SET total_estimated_cost = COALESCE((
             SELECT SUM(ai.estimated_budget)
               FROM procurements.app_items ai
              WHERE ai.app_version_id = v_id
                AND ai.deleted_at IS NULL
           ), 0),
           total_approved_cost = COALESCE((
             SELECT SUM(ai.estimated_budget)
               FROM procurements.app_items ai
              WHERE ai.app_version_id = v_id
                AND ai.deleted_at IS NULL
                AND ai.hope_review_status = 'approved'
           ), 0)
     WHERE av.id = v_id;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION procurements.recalc_app_version_total() IS
  'Maintains both app_versions totals from app_items. Recomputes the old and the new version so moving an item between versions cannot leave the source overstated.';

-- ============================================================
-- Also recompute when a review outcome changes, not only on item writes.
--
-- Reachability note: this updates app_versions, which carries
-- trg_prevent_approved_app_version_update. That guard cannot be tripped from
-- here, because prevent_locked_app_item_change (20260806) already refuses any
-- UPDATE to an app_item whose version is final/approved/superseded -- so a
-- review outcome can only change on an editable version. The same reasoning
-- protects recalc_app_version_total above, and is why Task 8's C1 only bit a
-- MIGRATION backfill and not normal operation.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.recalc_app_totals_on_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  UPDATE procurements.app_versions av
     SET total_approved_cost = COALESCE((
           SELECT SUM(ai.estimated_budget)
             FROM procurements.app_items ai
            WHERE ai.app_version_id = NEW.app_version_id
              AND ai.deleted_at IS NULL
              AND ai.hope_review_status = 'approved'
         ), 0)
   WHERE av.id = NEW.app_version_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_app_totals_on_review ON procurements.app_items;
CREATE TRIGGER trg_recalc_app_totals_on_review
  AFTER UPDATE OF hope_review_status ON procurements.app_items
  FOR EACH ROW
  WHEN (OLD.hope_review_status IS DISTINCT FROM NEW.hope_review_status)
  EXECUTE FUNCTION procurements.recalc_app_totals_on_review();

-- ============================================================
-- Backfill both columns for every existing version.
--
-- P2, WIDENED FORM. procurements.app_versions carries exactly three triggers:
--   trg_prevent_approved_app_version_update - raises when OLD.status = NEW.status
--       = 'approved'. This backfill touches approved versions and does not change
--       status, so BOTH sides are 'approved' and it would abort. Suspended.
--   trg_app_version_planning_stage          - raises only if planning_stage
--       changes. This backfill never touches it.
--   trg_snapshot_approved_app_version       - BEFORE UPDATE, but its body runs
--       only when NEW.status = 'approved' AND OLD.status <> 'approved'. Status is
--       untouched here, so it is a no-op and must NOT be suspended: leaving it on
--       costs nothing and keeps the snapshot path intact.
-- None of the three writes to any other table, so there is no indirect
-- collision. Verified against pg_trigger rather than assumed.
-- ============================================================

ALTER TABLE procurements.app_versions
  DISABLE TRIGGER trg_prevent_approved_app_version_update;

UPDATE procurements.app_versions av
   SET total_estimated_cost = COALESCE((
         SELECT SUM(ai.estimated_budget) FROM procurements.app_items ai
          WHERE ai.app_version_id = av.id AND ai.deleted_at IS NULL
       ), 0),
       total_approved_cost = COALESCE((
         SELECT SUM(ai.estimated_budget) FROM procurements.app_items ai
          WHERE ai.app_version_id = av.id
            AND ai.deleted_at IS NULL
            AND ai.hope_review_status = 'approved'
       ), 0);

ALTER TABLE procurements.app_versions
  ENABLE TRIGGER trg_prevent_approved_app_version_update;

-- ============================================================
-- finalize_app: stop computing a total with a third definition.
-- Body is the LIVE definition (20260810_lot_two_gate_model.sql), with only the
-- total computation removed.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.finalize_app(p_app_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'procurements', 'platform', 'auth', 'public'
AS $function$
DECLARE
  v_app         RECORD;
  v_version_id  UUID;
  v_pending_cnt INTEGER;
  v_unlotted    INTEGER;
  v_unfinal_lot INTEGER;
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

  -- All lots must have their composition locked (two-gate model, 20260810).
  SELECT COUNT(*) INTO v_unfinal_lot
    FROM procurements.app_lots
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND status = 'draft';

  IF v_unfinal_lot > 0 THEN
    RAISE EXCEPTION
      'Cannot finalize APP: % lots are still in draft. Lock their composition first (finalize_lot).',
      v_unfinal_lot;
  END IF;

  -- Snapshot indicative budgets (only if not already captured)
  UPDATE procurements.app_items
     SET indicative_budget = CASE
           WHEN indicative_budget IS NULL THEN estimated_budget
           ELSE indicative_budget
         END
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL;

  -- 20260815: finalize_app no longer computes a total.
  --
  -- It used to write the APPROVED-ONLY sum into total_estimated_cost, while
  -- recalc_app_version_total wrote the ALL-ITEMS sum into the same column. The
  -- column therefore meant different things before and after finalization, and
  -- which meaning you got depended on which routine wrote last. Both figures now
  -- have their own trigger-maintained column:
  --   total_estimated_cost = every non-deleted item
  --   total_approved_cost  = HOPE-approved items only
  UPDATE procurements.app_versions
     SET status = 'final'
   WHERE id = v_version_id;

  UPDATE procurements.apps
     SET status     = 'final',
         updated_at = NOW()
   WHERE id = p_app_id;
END;
$function$;

COMMIT;
