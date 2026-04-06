-- Migration: add delete_app_lot RPC
-- Soft-deletes a draft lot, unassigning all its items first.

CREATE OR REPLACE FUNCTION procurements.delete_app_lot(
  p_lot_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot RECORD;
BEGIN
  -- Select directly from app_lots (has division_id column) without JOIN
  SELECT *
    INTO v_lot
    FROM procurements.app_lots
   WHERE id = p_lot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lot % not found', p_lot_id;
  END IF;

  IF v_lot.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Lot % has already been deleted', p_lot_id;
  END IF;

  IF v_lot.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT procurements.has_permission('app.bac_manage_lots') THEN
    RAISE EXCEPTION 'Insufficient permissions to delete APP lots';
  END IF;

  IF v_lot.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft lots can be deleted';
  END IF;

  -- Unassign all items from this lot
  UPDATE procurements.app_items
     SET lot_id          = NULL,
         lot_item_number = NULL,
         updated_at      = NOW()
   WHERE lot_id     = p_lot_id
     AND deleted_at IS NULL;

  -- Soft-delete the lot
  UPDATE procurements.app_lots
     SET deleted_at = NOW(),
         updated_at = NOW()
   WHERE id = p_lot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.delete_app_lot(UUID) TO authenticated;
