-- Phase 13: Asset Management (Property) — Triggers
-- 1. Assignment insert → update asset custodian + close previous assignments
-- 2. Depreciation record insert → update asset accumulated/book_value

-- ============================================================
-- 1. trg_asset_assignment_update_custodian
--
-- On INSERT into asset_assignments, update the parent asset's
-- current_custodian_id to the new custodian. Also close any
-- previous current assignments for the same asset by setting
-- is_current = false and returned_date = CURRENT_DATE.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.update_asset_custodian()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  -- Close previous current assignments for this asset
  UPDATE procurements.asset_assignments
     SET is_current    = false,
         returned_date = COALESCE(returned_date, CURRENT_DATE),
         updated_at    = NOW()
   WHERE asset_id   = NEW.asset_id
     AND id        <> NEW.id
     AND is_current = true;

  -- Update the asset's current custodian
  UPDATE procurements.assets
     SET current_custodian_id = NEW.custodian_id,
         updated_at           = NOW()
   WHERE id = NEW.asset_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_asset_assignment_update_custodian
  AFTER INSERT ON procurements.asset_assignments
  FOR EACH ROW
  EXECUTE FUNCTION procurements.update_asset_custodian();

-- ============================================================
-- 2. trg_depreciation_update_asset
--
-- On INSERT into depreciation_records, update the parent asset's
-- accumulated_depreciation and book_value from the record values.
-- Each depreciation record carries the running totals, so we use
-- those directly rather than computing a sum.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.update_asset_from_depreciation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  UPDATE procurements.assets
     SET accumulated_depreciation = NEW.accumulated_amount,
         book_value               = NEW.book_value,
         updated_at               = NOW()
   WHERE id = NEW.asset_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_depreciation_update_asset
  AFTER INSERT ON procurements.depreciation_records
  FOR EACH ROW
  EXECUTE FUNCTION procurements.update_asset_from_depreciation();
