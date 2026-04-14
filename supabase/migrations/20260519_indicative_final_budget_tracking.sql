-- Phase 4: Indicative vs Final budget tracking
--
-- Adds indicative_budget column to app_items to capture the original estimated
-- budget at the indicative stage. When APP transitions to final, the current
-- estimated_budget is snapshotted into indicative_budget. A budget adjustment
-- RPC allows the budget officer to adjust item budgets during bac_finalization.

-- ============================================================
-- 1. Add columns
-- ============================================================
ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS indicative_budget NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS budget_adjusted_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS budget_adjusted_at TIMESTAMPTZ;

-- ============================================================
-- 2. Update finalize_app() to snapshot indicative budgets
-- ============================================================
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
     SET status             = 'final',
         indicative_final   = 'final',
         total_estimated_cost = v_total
   WHERE id = v_version_id;

  UPDATE procurements.apps
     SET status           = 'final',
         indicative_final = 'final',
         updated_at       = NOW()
   WHERE id = p_app_id;
END;
$$;

-- ============================================================
-- 3. Budget adjustment RPC
--    Allows budget officer to adjust item budgets during bac_finalization.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.adjust_app_item_budget(
  p_app_item_id UUID,
  p_new_budget  NUMERIC(15,2),
  p_notes       TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_item       RECORD;
  v_app        RECORD;
  v_lot_total  NUMERIC(15,2);
  v_version_total NUMERIC(15,2);
BEGIN
  IF p_new_budget < 0 THEN
    RAISE EXCEPTION 'Budget must be non-negative';
  END IF;

  IF NOT (procurements.has_permission('app.bac_manage_lots') OR procurements.has_permission('budget.certify')) THEN
    RAISE EXCEPTION 'Insufficient permissions to adjust APP item budget';
  END IF;

  SELECT ai.*, a.division_id, a.status AS app_status
    INTO v_item
    FROM procurements.app_items ai
    JOIN procurements.apps a ON a.id = ai.app_id
   WHERE ai.id = p_app_item_id
     AND ai.deleted_at IS NULL
     AND a.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP item % not found', p_app_item_id;
  END IF;

  IF v_item.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Access denied to APP item %', p_app_item_id;
  END IF;

  -- Only allow adjustments during bac_finalization stage
  IF v_item.app_status NOT IN ('bac_finalization', 'under_review') THEN
    RAISE EXCEPTION 'Budget adjustments are only allowed during BAC finalization or under review (current APP status: %)', v_item.app_status;
  END IF;

  -- Snapshot indicative budget if not already captured
  UPDATE procurements.app_items
     SET indicative_budget = CASE
           WHEN indicative_budget IS NULL THEN estimated_budget
           ELSE indicative_budget
         END,
         estimated_budget   = p_new_budget,
         budget_adjusted_by = auth.uid(),
         budget_adjusted_at = NOW(),
         remarks            = CASE
           WHEN p_notes IS NOT NULL AND LENGTH(TRIM(p_notes)) > 0
           THEN COALESCE(remarks || ' | ', '') || 'Budget adjusted: ' || p_notes
           ELSE remarks
         END,
         updated_at         = NOW()
   WHERE id = p_app_item_id;

  -- Recalculate lot total if item is in a lot
  IF v_item.lot_id IS NOT NULL THEN
    SELECT COALESCE(SUM(estimated_budget), 0) INTO v_lot_total
      FROM procurements.app_items
     WHERE lot_id = v_item.lot_id
       AND deleted_at IS NULL;

    UPDATE procurements.app_lots
       SET total_estimated_cost = v_lot_total,
           updated_at           = NOW()
     WHERE id = v_item.lot_id;
  END IF;

  -- Recalculate version total
  SELECT COALESCE(SUM(estimated_budget), 0) INTO v_version_total
    FROM procurements.app_items
   WHERE app_version_id = v_item.app_version_id
     AND deleted_at IS NULL;

  UPDATE procurements.app_versions
     SET total_estimated_cost = v_version_total
   WHERE id = v_item.app_version_id;
END;
$$;
