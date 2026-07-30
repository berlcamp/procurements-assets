-- ============================================================
-- Lock PPMP content once its version leaves draft.
--
-- Previously only ppmp_versions was protected. ppmp_projects,
-- ppmp_lots, and ppmp_lot_items were editable by the author at any
-- time, including after HOPE approval and after the rows had been
-- consolidated into the APP as the basis for an ABC.
--
-- COA framing: "approved procurement plan altered without amendment".
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.ppmp_version_is_editable(
  p_ppmp_version_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT COALESCE(
    (SELECT status = 'draft'
       FROM procurements.ppmp_versions
      WHERE id = p_ppmp_version_id),
    false
  );
$$;

COMMENT ON FUNCTION procurements.ppmp_version_is_editable(UUID) IS
  'A PPMP version''s content is editable only while the version is in draft. Any later change requires an amendment.';

CREATE OR REPLACE FUNCTION procurements.prevent_locked_ppmp_content_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_version_id UUID;
  v_status     TEXT;
BEGIN
  -- Resolve the owning version for whichever table fired.
  IF TG_TABLE_NAME = 'ppmp_projects' THEN
    v_version_id := COALESCE(NEW.ppmp_version_id, OLD.ppmp_version_id);

  ELSIF TG_TABLE_NAME = 'ppmp_lots' THEN
    SELECT pp.ppmp_version_id INTO v_version_id
      FROM procurements.ppmp_projects pp
     WHERE pp.id = COALESCE(NEW.ppmp_project_id, OLD.ppmp_project_id);

  ELSE -- ppmp_lot_items
    SELECT pp.ppmp_version_id INTO v_version_id
      FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
     WHERE pl.id = COALESCE(NEW.ppmp_lot_id, OLD.ppmp_lot_id);
  END IF;

  IF v_version_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_status
    FROM procurements.ppmp_versions
   WHERE id = v_version_id;

  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION
      'Cannot modify % on a PPMP version with status "%". Create an amendment instead.',
      TG_TABLE_NAME, v_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Guard UPDATE and DELETE. INSERT is allowed only into draft versions,
-- which the same check covers via NEW.
DROP TRIGGER IF EXISTS trg_ppmp_projects_immutable_when_locked ON procurements.ppmp_projects;

CREATE TRIGGER trg_ppmp_projects_immutable_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON procurements.ppmp_projects
  FOR EACH ROW EXECUTE FUNCTION procurements.prevent_locked_ppmp_content_change();

DROP TRIGGER IF EXISTS trg_ppmp_lots_immutable_when_locked ON procurements.ppmp_lots;

CREATE TRIGGER trg_ppmp_lots_immutable_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON procurements.ppmp_lots
  FOR EACH ROW EXECUTE FUNCTION procurements.prevent_locked_ppmp_content_change();

DROP TRIGGER IF EXISTS trg_ppmp_lot_items_immutable_when_locked ON procurements.ppmp_lot_items;

CREATE TRIGGER trg_ppmp_lot_items_immutable_when_locked
  BEFORE INSERT OR UPDATE OR DELETE ON procurements.ppmp_lot_items
  FOR EACH ROW EXECUTE FUNCTION procurements.prevent_locked_ppmp_content_change();

-- ============================================================
-- Tighten the RLS manage policies with the same predicate, so the
-- control is visible at the policy layer and not only in triggers.
-- ============================================================

DROP POLICY IF EXISTS "end_user_manage_ppmp_projects" ON procurements.ppmp_projects;

CREATE POLICY "end_user_manage_ppmp_projects" ON procurements.ppmp_projects
  FOR ALL TO authenticated
  USING (
    (created_by = auth.uid() OR procurements.has_permission('ppmp.edit'))
    AND office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
    AND procurements.ppmp_version_is_editable(ppmp_version_id)
  )
  WITH CHECK (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
    AND procurements.is_division_active()
    AND procurements.ppmp_version_is_editable(ppmp_version_id)
  );

DROP POLICY IF EXISTS "end_user_manage_ppmp_lots" ON procurements.ppmp_lots;

CREATE POLICY "end_user_manage_ppmp_lots" ON procurements.ppmp_lots
  FOR ALL TO authenticated
  USING (
    ppmp_project_id IN (
      SELECT pp.id FROM procurements.ppmp_projects pp
      WHERE (pp.created_by = auth.uid() OR procurements.has_permission('ppmp.edit'))
        AND pp.office_id IN (
          SELECT id FROM procurements.offices
          WHERE division_id = procurements.get_user_division_id()
        )
        AND procurements.ppmp_version_is_editable(pp.ppmp_version_id)
    )
  );

DROP POLICY IF EXISTS "end_user_manage_ppmp_lot_items" ON procurements.ppmp_lot_items;

CREATE POLICY "end_user_manage_ppmp_lot_items" ON procurements.ppmp_lot_items
  FOR ALL TO authenticated
  USING (
    ppmp_lot_id IN (
      SELECT pl.id FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
      WHERE (pp.created_by = auth.uid() OR procurements.has_permission('ppmp.edit'))
        AND pp.office_id IN (
          SELECT id FROM procurements.offices
          WHERE division_id = procurements.get_user_division_id()
        )
        AND procurements.ppmp_version_is_editable(pp.ppmp_version_id)
    )
  );
