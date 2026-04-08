-- Phase 7.1 — In-place edit for a single PR line item
--
-- Adds update_pr_item() so the UI can edit description/unit/quantity/unit_cost/remarks
-- on an existing draft pr_items row without having to remove + re-add it.
-- The same-mode and uniqueness triggers from step 1 still cover any
-- changes to app_item_id (we don't allow changing app_item_id here).

CREATE OR REPLACE FUNCTION procurements.update_pr_item(
  p_pr_item_id          UUID,
  p_description         TEXT,
  p_unit                TEXT,
  p_quantity            NUMERIC,
  p_estimated_unit_cost NUMERIC,
  p_remarks             TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_pi          RECORD;
  v_pr          RECORD;
  v_app_item    RECORD;
  v_row_total   NUMERIC;
  v_new_total   NUMERIC;
BEGIN
  SELECT * INTO v_pi FROM procurements.pr_items WHERE id = p_pr_item_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PR item not found';
  END IF;

  SELECT * INTO v_pr FROM procurements.purchase_requests WHERE id = v_pi.purchase_request_id;
  IF v_pr.status <> 'draft' THEN
    RAISE EXCEPTION 'Items can only be edited while the PR is in draft (current: %)', v_pr.status;
  END IF;
  IF v_pr.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Cannot modify a PR outside your division';
  END IF;

  IF p_quantity <= 0 OR p_estimated_unit_cost < 0 THEN
    RAISE EXCEPTION 'Quantity must be positive and unit cost non-negative';
  END IF;

  -- Validate against the linked APP item's budget
  IF v_pi.app_item_id IS NOT NULL THEN
    SELECT * INTO v_app_item FROM procurements.app_items WHERE id = v_pi.app_item_id;
    IF FOUND THEN
      v_row_total := p_quantity * p_estimated_unit_cost;
      IF v_row_total > v_app_item.estimated_budget::NUMERIC THEN
        RAISE EXCEPTION 'Line total (₱%) exceeds APP item budget (₱%)',
          v_row_total, v_app_item.estimated_budget;
      END IF;
    END IF;
  END IF;

  UPDATE procurements.pr_items
     SET description         = p_description,
         unit                = p_unit,
         quantity            = p_quantity,
         estimated_unit_cost = p_estimated_unit_cost,
         remarks             = NULLIF(p_remarks, ''),
         updated_at          = NOW()
   WHERE id = p_pr_item_id;

  -- Recalculate header total + re-check ceiling
  SELECT COALESCE(SUM(estimated_total_cost::NUMERIC), 0)
    INTO v_new_total
    FROM procurements.pr_items
   WHERE purchase_request_id = v_pi.purchase_request_id AND deleted_at IS NULL;

  IF v_pr.abc_ceiling IS NOT NULL AND v_new_total > v_pr.abc_ceiling THEN
    RAISE EXCEPTION 'Updated total (₱%) exceeds the ABC ceiling for % (₱%)',
      v_new_total, v_pr.procurement_mode, v_pr.abc_ceiling;
  END IF;

  UPDATE procurements.purchase_requests
     SET total_estimated_cost = v_new_total,
         updated_at           = NOW()
   WHERE id = v_pi.purchase_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.update_pr_item(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;
