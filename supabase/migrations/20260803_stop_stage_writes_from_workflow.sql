-- ============================================================
-- Remove planning-stage writes from workflow actions.
--
-- Before: approve_ppmp() set indicative_final='final', so an August
-- plan built on an indicative ceiling was labelled FINAL the moment
-- the SDS signed it; and create_ppmp_amendment() set 'indicative',
-- so the post-GAA revision was labelled INDICATIVE. Exactly inverted.
--
-- After: stage comes only from budget_ceilings via the Task 3 trigger.
-- ============================================================

-- 1. approve_ppmp: drop both indicative_final assignments
--    SOURCE: supabase/migrations/20240503_ppmp_rpc.sql:268-330 (only definition)
CREATE OR REPLACE FUNCTION procurements.approve_ppmp(
  p_ppmp_id UUID,
  p_notes   TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp       RECORD;
  v_version_id UUID;
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

  IF NOT procurements.has_permission('ppmp.approve') THEN
    RAISE EXCEPTION 'Insufficient permissions to approve PPMP %', p_ppmp_id;
  END IF;

  IF v_ppmp.status <> 'budget_certified' THEN
    RAISE EXCEPTION 'PPMP must be budget_certified before approval (current status: %)', v_ppmp.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.ppmp_versions
   WHERE ppmp_id        = p_ppmp_id
     AND version_number = v_ppmp.current_version;

  -- Approve the current version
  UPDATE procurements.ppmp_versions
     SET status      = 'approved',
         approved_by = auth.uid(),
         approved_at = NOW()
   WHERE id = v_version_id;

  -- Supersede all other non-approved, non-superseded versions
  UPDATE procurements.ppmp_versions
     SET status = 'superseded'
   WHERE ppmp_id = p_ppmp_id
     AND id      <> v_version_id
     AND status  NOT IN ('approved','superseded');

  -- Update parent PPMP record
  UPDATE procurements.ppmps
     SET status         = 'approved',
         approved_by    = auth.uid(),
         approved_at    = NOW(),
         approval_notes = p_notes,
         updated_at     = NOW()
   WHERE id = p_ppmp_id;

  -- AMENDED 2026-07-30: an approval_logs INSERT was originally specified here
  -- and has been REMOVED. It was scope creep — this task's mandate is to stop
  -- writing the planning stage, not to add audit logging. approve_ppmp has
  -- never written approval_logs, and adding it here would introduce an
  -- unreviewed behaviour change to an approval path mid-refactor.
  --
  -- The underlying gap is real and larger than this task: NOTHING writes
  -- approval_logs for PPMP or APP approvals today (only 'noted' remarks, via
  -- src/lib/actions/ppmp.ts:1282 and 20260405_ppmp_add_remark.sql). That is a
  -- COA traceability gap covering every approval step, and it needs one
  -- consistent design across chief_review / certify_budget / approve /
  -- return / finalize / approve_app — not a single insert smuggled in here.
  -- Tracked as a separate task; do not add it in Task 4.
END;
$$;

-- 2. sync_ppmp_on_version_approve: drop indicative_final
--    SOURCE: supabase/migrations/20240504_ppmp_triggers.sql:82-103 (only definition)
CREATE OR REPLACE FUNCTION procurements.sync_ppmp_on_version_approve()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    UPDATE procurements.ppmps
       SET current_version = NEW.version_number,
           updated_at      = NOW()
     WHERE id = NEW.ppmp_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. finalize_app: drop indicative_final on both tables.
--    SOURCE: supabase/migrations/20260519_indicative_final_budget_tracking.sql:19-122
--    (live definition — supersedes 20240603_app_rpc.sql). Copied verbatim;
--    the only edit is removing the two `indicative_final = 'final'` lines.
--    Lot-state gating (`status <> 'finalized'`) and all validation checks are
--    unchanged from the live source.
CREATE OR REPLACE FUNCTION procurements.finalize_app(
  p_app_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app         RECORD;
  v_version_id  UUID;
  v_pending_cnt INTEGER;
  v_unlotted    INTEGER;
  v_unfinal_lot INTEGER;
  v_total       NUMERIC(15,2);
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

  -- All lots must be finalized
  SELECT COUNT(*) INTO v_unfinal_lot
    FROM procurements.app_lots
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND status <> 'finalized';

  IF v_unfinal_lot > 0 THEN
    RAISE EXCEPTION 'Cannot finalize APP: % lots are not yet finalized', v_unfinal_lot;
  END IF;

  -- Snapshot indicative budgets (only if not already captured)
  UPDATE procurements.app_items
     SET indicative_budget = CASE
           WHEN indicative_budget IS NULL THEN estimated_budget
           ELSE indicative_budget
         END
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL;

  -- Calculate total
  SELECT COALESCE(SUM(estimated_budget), 0) INTO v_total
    FROM procurements.app_items
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND hope_review_status = 'approved';

  UPDATE procurements.app_versions
     SET status               = 'final',
         total_estimated_cost = v_total
   WHERE id = v_version_id;

  UPDATE procurements.apps
     SET status     = 'final',
         updated_at = NOW()
   WHERE id = p_app_id;
END;
$$;

-- 4. create_ppmp_amendment: remove indicative_final from the INSERT.
--    SOURCE: supabase/migrations/20240505_ppmp_restructure.sql:389-517
--    (live definition — supersedes 20240503_ppmp_rpc.sql). Copied verbatim;
--    the only edit is dropping `indicative_final` from the column list and
--    `'indicative'` from the VALUES list of the ppmp_versions INSERT.
CREATE OR REPLACE FUNCTION procurements.create_ppmp_amendment(
  p_ppmp_id       UUID,
  p_justification TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp            RECORD;
  v_approved_ver    RECORD;
  v_next_version    INTEGER;
  v_new_version_id  UUID;
  v_proj_rec        RECORD;
  v_new_project_id  UUID;
  v_lot_rec         RECORD;
  v_new_lot_id      UUID;
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
      INSERT INTO procurements.ppmp_lots (
        ppmp_project_id, lot_number, lot_title, procurement_mode,
        pre_procurement_conference, procurement_start, procurement_end,
        delivery_period, source_of_funds, estimated_budget,
        supporting_documents, remarks, budget_allocation_id
      ) VALUES (
        v_new_project_id, v_lot_rec.lot_number, v_lot_rec.lot_title,
        v_lot_rec.procurement_mode, v_lot_rec.pre_procurement_conference,
        v_lot_rec.procurement_start, v_lot_rec.procurement_end,
        v_lot_rec.delivery_period, v_lot_rec.source_of_funds,
        v_lot_rec.estimated_budget, v_lot_rec.supporting_documents,
        v_lot_rec.remarks, v_lot_rec.budget_allocation_id
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

  UPDATE procurements.ppmps
     SET current_version = v_next_version,
         status          = 'draft',
         updated_at      = NOW()
   WHERE id = p_ppmp_id;

  RETURN v_new_version_id;
END;
$$;

-- 5. create_app_amendment: same treatment.
--    SOURCE: supabase/migrations/20260516_app_cse_schedule_columns.sql:263-398
--    (live definition — supersedes 20260405_ppmp_app_amendment_logic.sql,
--    whose body lacks is_cse/schedule_quarter/advertisement_date/
--    bid_opening_date/award_date/contract_signing_date/
--    source_ppmp_project_description). Copied verbatim; edits are:
--      - drop `indicative_final` from the app_versions INSERT column list
--        and `'indicative'` from its VALUES list
--      - `UPDATE procurements.apps SET status = 'indicative'` becomes
--        `SET status = 'under_review'` (a workflow state, not a stage)
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
  INSERT INTO procurements.app_items (
    app_version_id, app_id,
    source_ppmp_project_id, source_ppmp_lot_id, source_ppmp_id,
    item_number, general_description, project_type,
    procurement_mode, estimated_budget, source_of_funds,
    procurement_start, procurement_end, delivery_period,
    budget_allocation_id, source_office_id,
    hope_review_status, hope_reviewed_by, hope_reviewed_at, hope_remarks,
    remarks, created_by,
    -- New fields
    source_ppmp_project_description, is_cse,
    schedule_quarter, advertisement_date, bid_opening_date,
    award_date, contract_signing_date
  )
  SELECT
    v_new_version_id, app_id,
    source_ppmp_project_id, source_ppmp_lot_id, source_ppmp_id,
    item_number, general_description, project_type,
    procurement_mode, estimated_budget, source_of_funds,
    procurement_start, procurement_end, delivery_period,
    budget_allocation_id, source_office_id,
    hope_review_status, hope_reviewed_by, hope_reviewed_at, hope_remarks,
    remarks, created_by,
    -- New fields
    source_ppmp_project_description, is_cse,
    schedule_quarter, advertisement_date, bid_opening_date,
    award_date, contract_signing_date
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

  -- Reassign cloned items to their corresponding cloned lots
  UPDATE procurements.app_items new_ai
     SET lot_id = new_lot.id
    FROM procurements.app_items old_ai
    JOIN procurements.app_lots old_lot ON old_lot.id = old_ai.lot_id
    JOIN procurements.app_lots new_lot
      ON new_lot.app_version_id = v_new_version_id
     AND new_lot.lot_number     = old_lot.lot_number
   WHERE new_ai.app_version_id = v_new_version_id
     AND old_ai.app_version_id = v_approved_ver.id
     AND old_ai.item_number    = new_ai.item_number
     AND old_ai.deleted_at     IS NULL
     AND old_ai.lot_id         IS NOT NULL;

  -- Update parent APP
  UPDATE procurements.apps
     SET current_version = v_next_version,
         status          = 'under_review',
         updated_at      = NOW()
   WHERE id = p_app_id;

  RETURN v_new_version_id;
END;
$$;
