-- Phase 7.1 — PR Bundling, Step 1 (additive, non-destructive)
--
-- Adds the columns, lookup table, and pr_items uniqueness trigger required to
-- support bundling multiple APP items into a single Purchase Request. This
-- migration is intentionally non-destructive: existing PRs continue to work
-- unchanged, and the deprecated `purchase_requests.app_item_id` /
-- `ppmp_item_id` / `lot_id` columns remain in place.
--
-- A follow-up migration will:
--   * Rewrite create_purchase_request() to accept multiple APP items
--   * Drop the deprecated columns and the old per-PR partial unique index

-- ============================================================
-- 1. Procurement method ceilings (RA 12009 reference data)
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.procurement_method_ceilings (
  procurement_mode TEXT          PRIMARY KEY,
  ceiling_amount   NUMERIC(15,2),                    -- NULL = no ceiling (e.g. competitive bidding)
  effective_from   DATE          NOT NULL,
  ra_reference     TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO procurements.procurement_method_ceilings
  (procurement_mode, ceiling_amount, effective_from, ra_reference, notes)
VALUES
  ('svp',                 1000000.00, '2024-07-26', 'RA 12009 Sec 53', 'Small Value Procurement'),
  ('shopping',            1000000.00, '2024-07-26', 'RA 12009',        'Shopping (limited use)'),
  ('competitive_bidding', NULL,       '2024-07-26', 'RA 12009 Sec 12', 'No ceiling — required default method'),
  ('direct_contracting',  NULL,       '2024-07-26', 'RA 12009',        'Conditions-based, no ceiling'),
  ('repeat_order',        NULL,       '2024-07-26', 'RA 12009',        'Conditions-based, no ceiling'),
  ('emergency',           NULL,       '2024-07-26', 'RA 12009',        'Conditions-based, no ceiling'),
  ('negotiated',          NULL,       '2024-07-26', 'RA 12009',        'Conditions-based, no ceiling'),
  ('agency_to_agency',    NULL,       '2024-07-26', 'RA 12009',        'Conditions-based, no ceiling')
ON CONFLICT (procurement_mode) DO NOTHING;

-- Read-only for all authenticated users; only super admin can write.
ALTER TABLE procurements.procurement_method_ceilings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_method_ceilings" ON procurements.procurement_method_ceilings
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "super_admin_manage_method_ceilings" ON procurements.procurement_method_ceilings
  FOR ALL TO authenticated
  USING (platform.is_super_admin())
  WITH CHECK (platform.is_super_admin());

-- ============================================================
-- 2. New PR header columns (additive)
-- ============================================================
ALTER TABLE procurements.purchase_requests
  ADD COLUMN IF NOT EXISTS procurement_mode TEXT,
  ADD COLUMN IF NOT EXISTS abc_ceiling      NUMERIC(15,2);

COMMENT ON COLUMN procurements.purchase_requests.procurement_mode IS
  'Unifying procurement method for all bundled APP items in this PR. Snapshot from app_items.procurement_mode at creation.';
COMMENT ON COLUMN procurements.purchase_requests.abc_ceiling IS
  'ABC ceiling for the chosen procurement_mode at creation time. NULL when the mode has no ceiling (e.g. Competitive Bidding).';

-- ============================================================
-- 3. Backfill procurement_mode + abc_ceiling from existing single-item PRs
-- ============================================================
UPDATE procurements.purchase_requests pr
   SET procurement_mode = LOWER(TRIM(ai.procurement_mode))
  FROM procurements.app_items ai
 WHERE pr.app_item_id = ai.id
   AND pr.procurement_mode IS NULL
   AND ai.procurement_mode IS NOT NULL;

-- Normalize legacy textual variants → canonical lowercase keys used by ceilings table
UPDATE procurements.purchase_requests
   SET procurement_mode = 'svp'
 WHERE LOWER(TRIM(procurement_mode)) IN ('small value procurement', 'svp');

UPDATE procurements.purchase_requests
   SET procurement_mode = 'shopping'
 WHERE LOWER(TRIM(procurement_mode)) = 'shopping';

UPDATE procurements.purchase_requests
   SET procurement_mode = 'competitive_bidding'
 WHERE LOWER(TRIM(procurement_mode)) IN ('public bidding', 'competitive bidding', 'bidding');

-- Snapshot the ceiling that applied at the time of backfill
UPDATE procurements.purchase_requests pr
   SET abc_ceiling = c.ceiling_amount
  FROM procurements.procurement_method_ceilings c
 WHERE pr.procurement_mode = c.procurement_mode
   AND pr.abc_ceiling IS NULL;

-- ============================================================
-- 4. Ensure pr_items.app_item_id is backfilled from the PR header
--     (the column already exists; just guarantee it's populated for legacy rows)
-- ============================================================
UPDATE procurements.pr_items pi
   SET app_item_id = pr.app_item_id
  FROM procurements.purchase_requests pr
 WHERE pi.purchase_request_id = pr.id
   AND pi.app_item_id IS NULL
   AND pr.app_item_id IS NOT NULL;

-- ============================================================
-- 5. Uniqueness trigger on pr_items
--     One active pr_item per APP item, where "active" means the parent PR
--     is not cancelled and not soft-deleted. PostgreSQL partial indexes
--     cannot reference other tables, so this is enforced via trigger.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.check_pr_item_app_item_unique()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_pr_id UUID;
  v_existing_pr_no TEXT;
BEGIN
  IF NEW.app_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Look for any other active pr_item referencing the same APP item.
  SELECT pr.id, pr.pr_number
    INTO v_existing_pr_id, v_existing_pr_no
    FROM procurements.pr_items pi
    JOIN procurements.purchase_requests pr ON pr.id = pi.purchase_request_id
   WHERE pi.app_item_id    = NEW.app_item_id
     AND pi.id             <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
     AND pi.deleted_at     IS NULL
     AND pr.deleted_at     IS NULL
     AND pr.status         <> 'cancelled'
     AND pr.id             <> NEW.purchase_request_id  -- allow rows in the same PR
   LIMIT 1;

  IF v_existing_pr_id IS NOT NULL THEN
    RAISE EXCEPTION 'APP item is already referenced by an active Purchase Request (%). Cancel it first or pick a different item.',
      v_existing_pr_no
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pr_items_app_item_unique ON procurements.pr_items;
CREATE TRIGGER trg_pr_items_app_item_unique
  BEFORE INSERT OR UPDATE OF app_item_id, purchase_request_id, deleted_at
  ON procurements.pr_items
  FOR EACH ROW
  EXECUTE FUNCTION procurements.check_pr_item_app_item_unique();

-- ============================================================
-- 6. Same-mode trigger on pr_items
--     Every line item in a PR must share the same procurement_mode (taken
--     from app_items). The first item written sets the PR's procurement_mode
--     and abc_ceiling if they are still NULL.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.check_pr_item_same_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_item_mode  TEXT;
  v_pr_mode    TEXT;
  v_ceiling    NUMERIC(15,2);
BEGIN
  IF NEW.app_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT LOWER(TRIM(procurement_mode))
    INTO v_item_mode
    FROM procurements.app_items
   WHERE id = NEW.app_item_id;

  IF v_item_mode IS NULL THEN
    -- APP item has no mode set; allow but don't auto-fill PR header.
    RETURN NEW;
  END IF;

  -- Normalize legacy variants
  v_item_mode := CASE
    WHEN v_item_mode IN ('small value procurement', 'svp') THEN 'svp'
    WHEN v_item_mode IN ('public bidding', 'competitive bidding', 'bidding') THEN 'competitive_bidding'
    ELSE v_item_mode
  END;

  SELECT procurement_mode INTO v_pr_mode
    FROM procurements.purchase_requests
   WHERE id = NEW.purchase_request_id;

  IF v_pr_mode IS NULL THEN
    -- First item — set the PR's mode and ceiling snapshot
    SELECT ceiling_amount INTO v_ceiling
      FROM procurements.procurement_method_ceilings
     WHERE procurement_mode = v_item_mode;

    UPDATE procurements.purchase_requests
       SET procurement_mode = v_item_mode,
           abc_ceiling      = v_ceiling
     WHERE id = NEW.purchase_request_id;
  ELSIF v_pr_mode <> v_item_mode THEN
    RAISE EXCEPTION 'All items in a Purchase Request must share the same procurement mode (PR is %, item is %)',
      v_pr_mode, v_item_mode;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pr_items_same_mode ON procurements.pr_items;
CREATE TRIGGER trg_pr_items_same_mode
  BEFORE INSERT OR UPDATE OF app_item_id, purchase_request_id
  ON procurements.pr_items
  FOR EACH ROW
  EXECUTE FUNCTION procurements.check_pr_item_same_mode();

-- ============================================================
-- 7. Verification queries (run manually after applying)
-- ============================================================
-- SELECT COUNT(*) FILTER (WHERE procurement_mode IS NULL) AS prs_missing_mode,
--        COUNT(*) FILTER (WHERE procurement_mode IS NOT NULL) AS prs_with_mode
--   FROM procurements.purchase_requests
--  WHERE deleted_at IS NULL AND status <> 'cancelled';
--
-- SELECT pr.id, pr.pr_number, pr.procurement_mode, COUNT(pi.id) AS item_count
--   FROM procurements.purchase_requests pr
--   JOIN procurements.pr_items pi ON pi.purchase_request_id = pr.id
--  WHERE pi.deleted_at IS NULL
--  GROUP BY pr.id, pr.pr_number, pr.procurement_mode
--  ORDER BY pr.created_at DESC
--  LIMIT 20;
