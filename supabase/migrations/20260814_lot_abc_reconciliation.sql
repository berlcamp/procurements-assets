-- ============================================================
-- Lot ABC must equal the sum of its line items.
--
-- Default behaviour: derived. The lot's estimated_budget is maintained by
-- trigger from ppmp_lot_items, so it cannot drift.
--
-- Escape hatch: abc_is_manual = true with a written justification, for the
-- genuine cases (a lump-sum infrastructure ABC from a programme of works,
-- where the line items are indicative quantities only).
--
-- An ABC unsupported by its own detail is a COA finding, and this one flows
-- into the APP, becomes the bid ceiling, and gates PR totals.
-- ============================================================

BEGIN;

ALTER TABLE procurements.ppmp_lots
  ADD COLUMN IF NOT EXISTS abc_is_manual BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS abc_manual_justification TEXT;

COMMENT ON COLUMN procurements.ppmp_lots.abc_is_manual IS
  'When false (default) estimated_budget is derived from the line items. When true it is entered manually and needs abc_manual_justification.';

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS; drop first so a re-run is a
-- no-op rather than an error.
ALTER TABLE procurements.ppmp_lots
  DROP CONSTRAINT IF EXISTS chk_manual_abc_has_justification;

ALTER TABLE procurements.ppmp_lots
  ADD CONSTRAINT chk_manual_abc_has_justification
  CHECK (
    abc_is_manual = false
    OR (abc_manual_justification IS NOT NULL
        AND LENGTH(TRIM(abc_manual_justification)) >= 10)
  );

-- ============================================================
-- Maintain the ABC from the line items.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.recalc_ppmp_lot_abc()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ids UUID[];
  v_id  UUID;
BEGIN
  -- P1. The plan wrote COALESCE(NEW.ppmp_lot_id, OLD.ppmp_lot_id), which on
  -- UPDATE always yields NEW. ppmp_lot_items.ppmp_lot_id is a plain updatable
  -- FK, so MOVING AN ITEM BETWEEN LOTS would recompute only the destination and
  -- leave the SOURCE lot's ABC permanently inflated by the moved item -- a
  -- silently overstated bid ceiling, which is the precise failure this whole
  -- task exists to prevent. Recompute BOTH sides.
  v_ids := ARRAY(
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.ppmp_lot_id END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.ppmp_lot_id END
    ]) AS x WHERE x IS NOT NULL
  );

  FOREACH v_id IN ARRAY v_ids LOOP
    UPDATE procurements.ppmp_lots
       SET estimated_budget = COALESCE((
             SELECT SUM(estimated_total_cost)
               FROM procurements.ppmp_lot_items
              WHERE ppmp_lot_id = v_id
           ), 0),
           updated_at = NOW()
     WHERE id = v_id
       AND abc_is_manual = false;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION procurements.recalc_ppmp_lot_abc() IS
  'Keeps ppmp_lots.estimated_budget equal to the sum of its line items, unless the lot is flagged abc_is_manual. Recomputes both the old and the new lot so moving an item between lots cannot leave the source overstated.';

-- ppmp_lot_items carries its own immutability guard
-- (trg_ppmp_lot_items_immutable_when_locked, 20260805), which raises BEFORE this
-- AFTER trigger runs. So an item write on a locked version never reaches here,
-- and the cascade into ppmp_lots can only ever touch an editable draft.
DROP TRIGGER IF EXISTS trg_recalc_ppmp_lot_abc ON procurements.ppmp_lot_items;
CREATE TRIGGER trg_recalc_ppmp_lot_abc
  AFTER INSERT OR UPDATE OR DELETE ON procurements.ppmp_lot_items
  FOR EACH ROW EXECUTE FUNCTION procurements.recalc_ppmp_lot_abc();

-- ============================================================
-- Backfill: bring every auto-maintained lot in line.
--
-- Lots whose current ABC exceeds their line total are flagged manual with an
-- audit note rather than silently reduced, because reducing an ABC that an
-- approved APP already published would change a bid ceiling.
--
-- P2, WIDENED FORM. procurements.ppmp_lots carries exactly three triggers:
--   trg_ppmp_lots_immutable_when_locked  - raises on any write to a lot under a
--       non-draft version (20260805). Both backfills touch approved versions,
--       so it is suspended here and restored immediately below.
--   trg_ppmp_lots_audit                  - writes to the audit table, which
--       carries no guards. Task 9 proved audit_trigger tolerates migration
--       context (20260802 backfilled ppmp_versions live and passed).
--   trg_ppmp_lots_updated_at             - writes only NEW.updated_at.
-- Neither of the two left enabled cascades into a guarded table, so suspending
-- the one guard is sufficient. Verified against pg_trigger, not assumed.
--
-- ALTER TABLE ... DISABLE TRIGGER is transactional and this file is wrapped in
-- BEGIN/COMMIT, so a failure restores it. Do NOT use SET session_replication_role:
-- it would disable the audit trigger too, and this backfill must be audit-logged.
-- ============================================================

ALTER TABLE procurements.ppmp_lots
  DISABLE TRIGGER trg_ppmp_lots_immutable_when_locked;

UPDATE procurements.ppmp_lots pl
   SET abc_is_manual = true,
       abc_manual_justification =
         'Backfill 20260814: pre-existing ABC of ' || pl.estimated_budget
         || ' did not match line total of ' || COALESCE(s.line_total, 0)
         || '. Flagged manual to preserve the published figure. Review and reconcile.'
  FROM (
    SELECT pl2.id, SUM(pli.estimated_total_cost) AS line_total
      FROM procurements.ppmp_lots pl2
      JOIN procurements.ppmp_lot_items pli ON pli.ppmp_lot_id = pl2.id
      JOIN procurements.ppmp_projects pp   ON pp.id = pl2.ppmp_project_id
      JOIN procurements.ppmp_versions pv   ON pv.id = pp.ppmp_version_id
     WHERE pv.status IN ('approved','superseded')
     GROUP BY pl2.id
  ) s
 WHERE s.id = pl.id
   AND pl.estimated_budget <> COALESCE(s.line_total, 0)
   AND pl.abc_is_manual = false;

-- Everything still auto-maintained gets recomputed.
UPDATE procurements.ppmp_lots pl
   SET estimated_budget = COALESCE((
         SELECT SUM(pli.estimated_total_cost)
           FROM procurements.ppmp_lot_items pli
          WHERE pli.ppmp_lot_id = pl.id
       ), 0),
       updated_at = NOW()
 WHERE pl.abc_is_manual = false
   AND pl.estimated_budget <> COALESCE((
         SELECT SUM(pli.estimated_total_cost)
           FROM procurements.ppmp_lot_items pli
          WHERE pli.ppmp_lot_id = pl.id
       ), 0);

ALTER TABLE procurements.ppmp_lots
  ENABLE TRIGGER trg_ppmp_lots_immutable_when_locked;

-- ============================================================
-- submit_ppmp: refuse a PPMP whose derived ABCs do not reconcile.
-- Body is the LIVE definition (20260813_version_authoritative_status.sql),
-- with one check added after the existing estimated_budget > 0 test.
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

  -- 20260814: a derived ABC must reconcile to its own line items.
  --
  -- The trigger on ppmp_lot_items keeps this true for every edit made through
  -- the application, so reaching this exception means the lot was written by
  -- some path that bypassed the trigger -- a migration, a manual fix, or a lot
  -- whose items were removed while the guard was suspended. It is a backstop,
  -- not the primary mechanism, and it is cheap.
  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
     WHERE pp.ppmp_version_id = v_version_id
       AND pp.deleted_at      IS NULL
       AND pl.abc_is_manual   = false
       AND pl.estimated_budget <> COALESCE((
             SELECT SUM(pli.estimated_total_cost)
               FROM procurements.ppmp_lot_items pli
              WHERE pli.ppmp_lot_id = pl.id
           ), 0)
  ) THEN
    RAISE EXCEPTION
      'One or more lots have an ABC that does not match the sum of their line items. '
      'Either correct the line items or mark the ABC manual with a justification.';
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
