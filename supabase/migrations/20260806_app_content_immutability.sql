-- ============================================================
-- Lock APP content once its version is final or approved.
--
-- Editable window for app_items: version status in
-- ('draft','under_review','bac_finalization').
-- After that, changes require an amendment version.
--
-- Two behaviours are preserved deliberately:
--   1. The lotting RPCs write lot_id / lot_item_number while the
--      version is still editable — covered by the window above.
--   2. finalize_app() writes indicative_budget and totals in the same
--      transaction that flips the version to 'final'. The trigger reads
--      the CURRENT stored status, which is still pre-final at that
--      point, so those writes pass. Do not reorder that.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.app_version_is_editable(
  p_app_version_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT COALESCE(
    (SELECT status IN ('draft','under_review','bac_finalization')
       FROM procurements.app_versions
      WHERE id = p_app_version_id),
    false
  );
$$;

COMMENT ON FUNCTION procurements.app_version_is_editable(UUID) IS
  'APP item content is editable only while the version is draft/under_review/bac_finalization.';

-- AMENDED 2026-07-30. The version originally written here had the same defect
-- that Task 6 shipped and had to fix twice:
--
--   WHERE id = COALESCE(NEW.app_version_id, OLD.app_version_id)
--
-- On UPDATE that always resolves to NEW, so the guard only ever checked the
-- version a row was moving TO. app_items.app_version_id is a plain updatable
-- FK, so this single statement laundered locked content into a draft version
-- while rewriting its budget:
--
--   UPDATE procurements.app_items
--      SET app_version_id = <a draft version>, estimated_budget = 999999
--    WHERE id = <item in an approved version>;
--
-- It also failed OPEN when the version could not be resolved.
--
-- Requirements, mirroring the corrected Task 6 guard:
--   * branch explicitly on TG_OP — never COALESCE(NEW.x, OLD.x)
--   * INSERT  -> NEW's version must be editable
--   * DELETE  -> OLD's version must be editable
--   * UPDATE  -> BOTH OLD's and NEW's versions must be editable
--   * fail CLOSED (RAISE) when a version cannot be resolved
--   * distinguish the refusals: same version = a frozen-content edit;
--     different versions = a move out of, or into, a locked version
CREATE OR REPLACE FUNCTION procurements.prevent_locked_app_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_status_old TEXT;
  v_status_new TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status_old
      FROM procurements.app_versions WHERE id = OLD.app_version_id;

    IF v_status_old IS NULL THEN
      RAISE EXCEPTION
        'Cannot delete APP item: owning APP version could not be resolved';
    END IF;

    IF v_status_old NOT IN ('draft','under_review','bac_finalization') THEN
      RAISE EXCEPTION
        'Cannot delete APP items on a version with status "%". Create an APP amendment instead.',
        v_status_old;
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_status_new
      FROM procurements.app_versions WHERE id = NEW.app_version_id;

    IF v_status_new IS NULL THEN
      RAISE EXCEPTION
        'Cannot insert APP item: owning APP version could not be resolved';
    END IF;

    IF v_status_new NOT IN ('draft','under_review','bac_finalization') THEN
      RAISE EXCEPTION
        'Cannot add APP items to a version with status "%". Create an APP amendment instead.',
        v_status_new;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT status INTO v_status_old
      FROM procurements.app_versions WHERE id = OLD.app_version_id;
    SELECT status INTO v_status_new
      FROM procurements.app_versions WHERE id = NEW.app_version_id;

    IF v_status_old IS NULL THEN
      RAISE EXCEPTION
        'Cannot update APP item: owning APP version (old) could not be resolved';
    END IF;
    IF v_status_new IS NULL THEN
      RAISE EXCEPTION
        'Cannot update APP item: owning APP version (new) could not be resolved';
    END IF;

    IF OLD.app_version_id = NEW.app_version_id THEN
      IF v_status_old NOT IN ('draft','under_review','bac_finalization') THEN
        RAISE EXCEPTION
          'Cannot modify APP items on a version with status "%". Create an APP amendment instead.',
          v_status_old;
      END IF;
    ELSE
      IF v_status_old NOT IN ('draft','under_review','bac_finalization') THEN
        RAISE EXCEPTION
          'Cannot move APP items out of a version with status "%". Create an APP amendment instead.',
          v_status_old;
      END IF;
      IF v_status_new NOT IN ('draft','under_review','bac_finalization') THEN
        RAISE EXCEPTION
          'Cannot move APP items into a version with status "%". Create an APP amendment instead.',
          v_status_new;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unexpected trigger operation: %', TG_OP;
END;
$$;

COMMENT ON FUNCTION procurements.prevent_locked_app_item_change() IS
  'Guards app_items once the owning version leaves the editable window. Branches on TG_OP and checks both sides of an UPDATE, so a reparenting move cannot launder locked content into a draft version.';

DROP TRIGGER IF EXISTS trg_app_items_immutable_when_locked ON procurements.app_items;

CREATE TRIGGER trg_app_items_immutable_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON procurements.app_items
  FOR EACH ROW EXECUTE FUNCTION procurements.prevent_locked_app_item_change();

-- Mirror of prevent_approved_ppmp_version_update, which had no APP twin.
-- Guards only approved -> approved, so the final -> approved transition
-- and its snapshot write still succeed.
CREATE OR REPLACE FUNCTION procurements.prevent_approved_app_version_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status = 'approved' THEN
    RAISE EXCEPTION
      'Cannot modify an approved APP version (version %). Create an amendment instead.',
      OLD.version_number;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_approved_app_version_update ON procurements.app_versions;

CREATE TRIGGER trg_prevent_approved_app_version_update
  BEFORE UPDATE ON procurements.app_versions
  FOR EACH ROW EXECUTE FUNCTION procurements.prevent_approved_app_version_update();

-- ============================================================
-- Tighten the manage policy with the editable-window predicate.
--
-- Fix round 1: the original draft of this policy (a) dropped the
-- platform.is_super_admin() bypass that 20260729 had, (b) added
-- app.bac_manage_lots — broader than the original three permissions,
-- and unnecessary since the BAC lotting RPCs are all SECURITY DEFINER
-- and bypass RLS anyway, and (c) supplied an explicit WITH CHECK that
-- omitted the permission block entirely. Because the 20260729 policy
-- had no WITH CHECK at all, Postgres had reused USING (including its
-- permission block) to check INSERTs; replacing that with a weaker
-- explicit WITH CHECK silently removed the permission requirement from
-- INSERT, a privilege escalation. All three are fixed below:
--   * platform.is_super_admin() restored as a top-level bypass in BOTH
--     clauses (this plan's standing pattern for super-admin access).
--   * permission set restored to exactly the original three.
--   * WITH CHECK now mirrors USING's permission block and editable-
--     window predicate, so INSERT is no weaker than UPDATE.
--
-- Two deliberate asymmetries between USING and WITH CHECK:
--   * deleted_at IS NULL stays in USING only. That preserves the
--     20260729 soft-delete visibility fix (a merged-away row must not
--     appear as a phantom in the available-items pool) while still
--     allowing a soft delete to be WRITTEN — a soft delete is an
--     UPDATE that SETs deleted_at, and WITH CHECK evaluates the new
--     row, which by definition now has deleted_at set.
--   * procurements.is_division_active() appears in WITH CHECK only.
--     This was NOT in the 20260729 policy at all; it is a new addition
--     because every other write policy in this plan carries it, and a
--     suspended division should not be able to create new rows.
-- ============================================================

DROP POLICY IF EXISTS "division_admin_manage_app_items" ON procurements.app_items;

CREATE POLICY "division_admin_manage_app_items" ON procurements.app_items
  FOR ALL TO authenticated
  USING (
    platform.is_super_admin()
    OR (
      deleted_at IS NULL
      AND app_id IN (
        SELECT id FROM procurements.apps
         WHERE division_id = procurements.get_user_division_id()
           AND deleted_at IS NULL
      )
      AND (
        procurements.has_permission('app.manage')
        OR procurements.has_permission('app.hope_review')
        OR procurements.has_permission('app.approve')
      )
      AND procurements.app_version_is_editable(app_version_id)
    )
  )
  WITH CHECK (
    platform.is_super_admin()
    OR (
      app_id IN (
        SELECT id FROM procurements.apps
         WHERE division_id = procurements.get_user_division_id()
           AND deleted_at IS NULL
      )
      AND (
        procurements.has_permission('app.manage')
        OR procurements.has_permission('app.hope_review')
        OR procurements.has_permission('app.approve')
      )
      AND procurements.app_version_is_editable(app_version_id)
      AND procurements.is_division_active()
    )
  );
