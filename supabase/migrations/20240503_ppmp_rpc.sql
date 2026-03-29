-- Phase 5: PPMP RPC functions

-- ============================================================
-- submit_ppmp(p_ppmp_id)
-- Validates and advances PPMP from 'draft' → 'submitted'.
-- Called by: end_user or anyone with ppmp.submit permission.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.submit_ppmp(
  p_ppmp_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp          RECORD;
  v_item_count    INTEGER;
  v_version_id    UUID;
  v_alloc_rec     RECORD;
BEGIN
  -- Load PPMP and enforce division isolation
  SELECT *
    INTO v_ppmp
    FROM procurements.ppmps
   WHERE id          = p_ppmp_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  -- Only creator or someone with ppmp.submit may submit
  IF v_ppmp.created_by <> auth.uid()
    AND NOT procurements.has_permission('ppmp.submit')
  THEN
    RAISE EXCEPTION 'Insufficient permissions to submit PPMP %', p_ppmp_id;
  END IF;

  -- Must be in draft status
  IF v_ppmp.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft PPMPs can be submitted (current status: %)', v_ppmp.status;
  END IF;

  -- Resolve the current version id
  SELECT id INTO v_version_id
    FROM procurements.ppmp_versions
   WHERE ppmp_id        = p_ppmp_id
     AND version_number = v_ppmp.current_version;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'No version found for PPMP % (version %)', p_ppmp_id, v_ppmp.current_version;
  END IF;

  -- At least one item must exist
  SELECT COUNT(*) INTO v_item_count
    FROM procurements.ppmp_items
   WHERE ppmp_version_id = v_version_id
     AND deleted_at      IS NULL;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Cannot submit PPMP % — it has no items', p_ppmp_id;
  END IF;

  -- All items: Q1+Q2+Q3+Q4 must equal quantity (defensive re-check)
  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_items
     WHERE ppmp_version_id = v_version_id
       AND deleted_at      IS NULL
       AND ROUND(schedule_q1 + schedule_q2 + schedule_q3 + schedule_q4, 4)
           <> ROUND(quantity, 4)
  ) THEN
    RAISE EXCEPTION 'One or more PPMP items have quarterly schedules that do not sum to the total quantity';
  END IF;

  -- Budget availability check: sum of item costs per allocation must not exceed available balance
  FOR v_alloc_rec IN
    SELECT
      pi.budget_allocation_id,
      SUM(pi.estimated_total_cost) AS ppmp_total,
      ba.adjusted_amount,
      ba.obligated_amount
    FROM procurements.ppmp_items pi
    JOIN procurements.budget_allocations ba ON ba.id = pi.budget_allocation_id
   WHERE pi.ppmp_version_id   = v_version_id
     AND pi.deleted_at        IS NULL
     AND pi.budget_allocation_id IS NOT NULL
   GROUP BY pi.budget_allocation_id, ba.adjusted_amount, ba.obligated_amount
  LOOP
    IF v_alloc_rec.ppmp_total > (v_alloc_rec.adjusted_amount - v_alloc_rec.obligated_amount) THEN
      RAISE EXCEPTION
        'PPMP items for allocation % exceed available budget (PPMP total: %, available: %)',
        v_alloc_rec.budget_allocation_id,
        v_alloc_rec.ppmp_total,
        (v_alloc_rec.adjusted_amount - v_alloc_rec.obligated_amount);
    END IF;
  END LOOP;

  -- Advance status
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
$$;

-- ============================================================
-- chief_review_ppmp(p_ppmp_id, p_action, p_notes)
-- Section Chief or School Head forwards or returns PPMP.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.chief_review_ppmp(
  p_ppmp_id UUID,
  p_action  TEXT,
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
  IF p_action NOT IN ('forward', 'return') THEN
    RAISE EXCEPTION 'Invalid action %. Must be ''forward'' or ''return''', p_action;
  END IF;

  SELECT *
    INTO v_ppmp
    FROM procurements.ppmps
   WHERE id          = p_ppmp_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  IF NOT procurements.has_permission('ppmp.chief_review') THEN
    RAISE EXCEPTION 'Insufficient permissions to review PPMP %', p_ppmp_id;
  END IF;

  IF v_ppmp.status <> 'submitted' THEN
    RAISE EXCEPTION 'PPMP must be in submitted status for chief review (current status: %)', v_ppmp.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.ppmp_versions
   WHERE ppmp_id        = p_ppmp_id
     AND version_number = v_ppmp.current_version;

  IF p_action = 'forward' THEN
    UPDATE procurements.ppmps
       SET status              = 'chief_reviewed',
           chief_reviewed_by   = auth.uid(),
           chief_reviewed_at   = NOW(),
           chief_review_notes  = p_notes,
           updated_at          = NOW()
     WHERE id = p_ppmp_id;

    UPDATE procurements.ppmp_versions
       SET status = 'chief_reviewed'
     WHERE id = v_version_id;

  ELSIF p_action = 'return' THEN
    UPDATE procurements.ppmps
       SET status             = 'revision_required',
           chief_reviewed_by  = auth.uid(),
           chief_reviewed_at  = NOW(),
           chief_review_notes = p_notes,
           updated_at         = NOW()
     WHERE id = p_ppmp_id;

    UPDATE procurements.ppmp_versions
       SET status = 'draft'
     WHERE id = v_version_id;
  END IF;
END;
$$;

-- ============================================================
-- certify_ppmp_budget(p_ppmp_id, p_notes)
-- Budget Officer certifies budget availability.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.certify_ppmp_budget(
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

  IF NOT procurements.has_permission('ppmp.certify_budget') THEN
    RAISE EXCEPTION 'Insufficient permissions to certify budget for PPMP %', p_ppmp_id;
  END IF;

  IF v_ppmp.status <> 'chief_reviewed' THEN
    RAISE EXCEPTION 'PPMP must be chief_reviewed before budget certification (current status: %)', v_ppmp.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.ppmp_versions
   WHERE ppmp_id        = p_ppmp_id
     AND version_number = v_ppmp.current_version;

  UPDATE procurements.ppmps
     SET status                    = 'budget_certified',
         budget_certified_by       = auth.uid(),
         budget_certified_at       = NOW(),
         budget_certification_notes = p_notes,
         updated_at                = NOW()
   WHERE id = p_ppmp_id;

  UPDATE procurements.ppmp_versions
     SET status = 'budget_certified'
   WHERE id = v_version_id;
END;
$$;

-- ============================================================
-- approve_ppmp(p_ppmp_id, p_notes)
-- HOPE gives final approval; marks version as approved and
-- supersedes any remaining draft/in-progress versions.
-- ============================================================

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
     SET status          = 'approved',
         indicative_final = 'final',
         approved_by      = auth.uid(),
         approved_at      = NOW()
   WHERE id = v_version_id;

  -- Snapshot is populated by trg_snapshot_approved_ppmp_version (BEFORE UPDATE trigger)

  -- Supersede all other non-approved, non-superseded versions for this PPMP
  UPDATE procurements.ppmp_versions
     SET status = 'superseded'
   WHERE ppmp_id = p_ppmp_id
     AND id      <> v_version_id
     AND status  NOT IN ('approved','superseded');

  -- Update parent PPMP record
  UPDATE procurements.ppmps
     SET status           = 'approved',
         indicative_final = 'final',
         approved_by      = auth.uid(),
         approved_at      = NOW(),
         approval_notes   = p_notes,
         updated_at       = NOW()
   WHERE id = p_ppmp_id;
END;
$$;

-- ============================================================
-- return_ppmp(p_ppmp_id, p_step, p_notes)
-- Returns a PPMP to a previous workflow step.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.return_ppmp(
  p_ppmp_id UUID,
  p_step    TEXT,
  p_notes   TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp        RECORD;
  v_new_status  TEXT;
  v_version_id  UUID;
BEGIN
  IF p_step NOT IN ('to_end_user', 'to_chief', 'to_budget') THEN
    RAISE EXCEPTION 'Invalid step %. Must be ''to_end_user'', ''to_chief'', or ''to_budget''', p_step;
  END IF;

  SELECT *
    INTO v_ppmp
    FROM procurements.ppmps
   WHERE id          = p_ppmp_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  IF NOT procurements.has_permission('ppmp.return') THEN
    RAISE EXCEPTION 'Insufficient permissions to return PPMP %', p_ppmp_id;
  END IF;

  -- Map step to target status
  v_new_status := CASE p_step
    WHEN 'to_end_user' THEN 'revision_required'
    WHEN 'to_chief'    THEN 'submitted'
    WHEN 'to_budget'   THEN 'chief_reviewed'
  END;

  SELECT id INTO v_version_id
    FROM procurements.ppmp_versions
   WHERE ppmp_id        = p_ppmp_id
     AND version_number = v_ppmp.current_version;

  UPDATE procurements.ppmps
     SET status     = v_new_status,
         -- Store return notes in the most appropriate notes field based on direction
         chief_review_notes        = CASE WHEN p_step = 'to_end_user' THEN p_notes ELSE chief_review_notes END,
         budget_certification_notes = CASE WHEN p_step = 'to_chief'   THEN p_notes ELSE budget_certification_notes END,
         approval_notes            = CASE WHEN p_step = 'to_budget'   THEN p_notes ELSE approval_notes END,
         updated_at = NOW()
   WHERE id = p_ppmp_id;

  -- Revert the version status to align with the target step
  UPDATE procurements.ppmp_versions
     SET status = CASE v_new_status
       WHEN 'revision_required' THEN 'draft'
       WHEN 'submitted'         THEN 'submitted'
       WHEN 'chief_reviewed'    THEN 'chief_reviewed'
     END
   WHERE id = v_version_id;
END;
$$;

-- ============================================================
-- create_ppmp_amendment(p_ppmp_id, p_justification)
-- Creates a new amendment version cloning all items from the
-- currently approved version.
-- Returns: new ppmp_version_id
-- ============================================================

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

  -- Only creator or someone with ppmp.amend may initiate amendment
  IF v_ppmp.created_by <> auth.uid()
    AND NOT procurements.has_permission('ppmp.amend')
  THEN
    RAISE EXCEPTION 'Insufficient permissions to amend PPMP %', p_ppmp_id;
  END IF;

  IF v_ppmp.status NOT IN ('approved', 'locked') THEN
    RAISE EXCEPTION 'Only approved or locked PPMPs can be amended (current status: %)', v_ppmp.status;
  END IF;

  -- Prevent multiple simultaneous draft versions
  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_versions
     WHERE ppmp_id = p_ppmp_id
       AND status  = 'draft'
  ) THEN
    RAISE EXCEPTION 'An amendment is already in progress for PPMP %. Finish or discard it first.', p_ppmp_id;
  END IF;

  -- Find the currently approved version to clone from
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

  -- Create the new amendment version
  INSERT INTO procurements.ppmp_versions (
    ppmp_id,
    version_number,
    version_type,
    amendment_justification,
    total_estimated_cost,
    status,
    indicative_final,
    office_id,
    created_by
  ) VALUES (
    p_ppmp_id,
    v_next_version,
    'amendment',
    p_justification,
    v_approved_ver.total_estimated_cost,
    'draft',
    'indicative',
    v_approved_ver.office_id,
    auth.uid()
  )
  RETURNING id INTO v_new_version_id;

  -- Clone all non-deleted items from the approved version
  INSERT INTO procurements.ppmp_items (
    ppmp_version_id,
    ppmp_id,
    item_number,
    category,
    description,
    unit,
    quantity,
    estimated_unit_cost,
    procurement_method,
    budget_allocation_id,
    schedule_q1,
    schedule_q2,
    schedule_q3,
    schedule_q4,
    is_cse,
    remarks,
    office_id,
    created_by
  )
  SELECT
    v_new_version_id,
    pi.ppmp_id,
    pi.item_number,
    pi.category,
    pi.description,
    pi.unit,
    pi.quantity,
    pi.estimated_unit_cost,
    pi.procurement_method,
    pi.budget_allocation_id,
    pi.schedule_q1,
    pi.schedule_q2,
    pi.schedule_q3,
    pi.schedule_q4,
    pi.is_cse,
    pi.remarks,
    pi.office_id,
    auth.uid()
  FROM procurements.ppmp_items pi
  WHERE pi.ppmp_version_id = v_approved_ver.id
    AND pi.deleted_at      IS NULL;

  -- Advance the PPMP to the new draft version
  UPDATE procurements.ppmps
     SET current_version = v_next_version,
         status          = 'draft',
         updated_at      = NOW()
   WHERE id = p_ppmp_id;

  RETURN v_new_version_id;
END;
$$;

-- ============================================================
-- get_ppmp_version_history(p_ppmp_id)
-- Returns version history with item counts, ordered newest first.
-- Division isolation enforced.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.get_ppmp_version_history(
  p_ppmp_id UUID
)
RETURNS TABLE (
  version_number          INTEGER,
  version_type            TEXT,
  status                  TEXT,
  indicative_final        TEXT,
  total_estimated_cost    NUMERIC(15,2),
  amendment_justification TEXT,
  approved_by             UUID,
  approved_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ,
  item_count              BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  -- Division isolation: caller must belong to the same division as the PPMP
  IF NOT EXISTS (
    SELECT 1
      FROM procurements.ppmps
     WHERE id          = p_ppmp_id
       AND division_id = procurements.get_user_division_id()
       AND deleted_at  IS NULL
  ) THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  RETURN QUERY
  SELECT
    pv.version_number,
    pv.version_type,
    pv.status,
    pv.indicative_final,
    pv.total_estimated_cost,
    pv.amendment_justification,
    pv.approved_by,
    pv.approved_at,
    pv.created_at,
    COUNT(pi.id) AS item_count
  FROM procurements.ppmp_versions pv
  LEFT JOIN procurements.ppmp_items pi
         ON pi.ppmp_version_id = pv.id
        AND pi.deleted_at      IS NULL
  WHERE pv.ppmp_id = p_ppmp_id
  GROUP BY
    pv.version_number,
    pv.version_type,
    pv.status,
    pv.indicative_final,
    pv.total_estimated_cost,
    pv.amendment_justification,
    pv.approved_by,
    pv.approved_at,
    pv.created_at
  ORDER BY pv.version_number DESC;
END;
$$;
