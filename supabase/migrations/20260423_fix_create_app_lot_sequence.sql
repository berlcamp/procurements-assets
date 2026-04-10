-- Fix: create_app_lot reused lot_number after soft-delete.
--
-- The previous implementation computed next lot number with:
--   WHERE app_version_id = v_version_id AND deleted_at IS NULL
-- Soft-deleted lots were excluded from MAX(), so their number
-- could be reused — hitting the (app_version_id, lot_number) unique constraint.
--
-- Fix: include all rows (deleted or not) in the MAX() so lot numbers
-- are always monotonically increasing and never reused.

CREATE OR REPLACE FUNCTION procurements.create_app_lot(
  p_app_id              UUID,
  p_lot_name            TEXT,
  p_description         TEXT DEFAULT NULL,
  p_procurement_method  TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app          RECORD;
  v_version_id   UUID;
  v_next_lot_num INTEGER;
  v_lot_id       UUID;
BEGIN
  SELECT * INTO v_app
    FROM procurements.apps
   WHERE id          = p_app_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  IF NOT procurements.has_permission('app.bac_manage_lots') THEN
    RAISE EXCEPTION 'Insufficient permissions to manage APP lots';
  END IF;

  -- Get current working version
  SELECT id INTO v_version_id
    FROM procurements.app_versions
   WHERE app_id = p_app_id
     AND status NOT IN ('approved','superseded')
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'No active version found for APP %', p_app_id;
  END IF;

  -- Get next lot number — include soft-deleted rows so numbers are never reused.
  SELECT COALESCE(MAX(lot_number), 0) + 1
    INTO v_next_lot_num
    FROM procurements.app_lots
   WHERE app_version_id = v_version_id;

  INSERT INTO procurements.app_lots (
    app_id, app_version_id, lot_number, lot_name, description,
    procurement_method, division_id, created_by
  ) VALUES (
    p_app_id, v_version_id, v_next_lot_num, p_lot_name, p_description,
    p_procurement_method, v_app.division_id, auth.uid()
  )
  RETURNING id INTO v_lot_id;

  RETURN v_lot_id;
END;
$$;
