-- Fix: create_app_lot again reused lot_number after soft-delete.
--
-- 20260423_fix_create_app_lot_sequence.sql originally fixed this by
-- computing the next lot number across ALL rows (deleted or not).
-- 20260518_app_lot_method_required.sql later re-created the function to
-- add the required-procurement_method logic, but reintroduced the
--   AND deleted_at IS NULL
-- filter in the MAX() — silently regressing the fix.
--
-- The unique constraint UNIQUE (app_version_id, lot_number) covers all
-- rows including soft-deleted ones, and delete_app_lot only soft-deletes.
-- So after deleting the highest-numbered lot, the next insert recomputed
-- the same number and hit:
--   duplicate key value violates unique constraint
--   "app_lots_app_version_id_lot_number_key"
--
-- Fix: drop the deleted_at filter from the MAX() so lot numbers are always
-- monotonically increasing and never reused. All other behaviour (the
-- required procurement_method validation from 20260518) is preserved.

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
  -- Require procurement_method
  IF p_procurement_method IS NULL OR TRIM(p_procurement_method) = '' THEN
    RAISE EXCEPTION 'Procurement method is required when creating an APP lot';
  END IF;

  IF p_procurement_method NOT IN (
    'competitive_bidding','limited_source_bidding','direct_contracting',
    'repeat_order','shopping','svp','negotiated','agency_to_agency','emergency'
  ) THEN
    RAISE EXCEPTION 'Invalid procurement method: %', p_procurement_method;
  END IF;

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

  -- Get next lot number — include soft-deleted rows so numbers are never
  -- reused (the unique constraint spans all rows, deleted or not).
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
