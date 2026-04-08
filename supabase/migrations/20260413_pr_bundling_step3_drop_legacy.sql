-- Phase 7.1 — PR Bundling, Step 3 (drop deprecated single-item columns)
--
-- Removes the deprecated `app_item_id`, `ppmp_item_id`, `lot_id` columns from
-- purchase_requests. Step 2 stopped reading them; Step 1's pr_items triggers
-- already enforce the new uniqueness + same-mode rules. This migration also:
--
--   * Drops the partial unique index from 20260410 (replaced by trigger)
--   * Drops the legacy single-column indexes
--   * Recreates update_pr_items() so each item carries its own app_item_id
--   * Recreates check_split_contract() to join via pr_items.app_item_id
--   * DROPs the columns last
--
-- This migration is destructive. Make sure step 1 + step 2 ran cleanly and
-- backfill verification queries returned the expected counts before applying.

-- ============================================================
-- 1. Drop indexes that depend on the columns
-- ============================================================
DROP INDEX IF EXISTS procurements.uq_pr_active_per_app_item;
DROP INDEX IF EXISTS procurements.idx_prs_app_item_id;
DROP INDEX IF EXISTS procurements.idx_prs_lot_id;

-- ============================================================
-- 2. Recreate update_pr_items() to require app_item_id per row.
--    Items still go through the pr_items triggers (uniqueness + same-mode).
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.update_pr_items(
  p_pr_id UUID,
  p_items JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_pr            RECORD;
  v_item          JSONB;
  v_item_number   INT := 0;
  v_total_cost    NUMERIC := 0;
  v_app_item_id   UUID;
BEGIN
  SELECT * INTO v_pr FROM procurements.purchase_requests WHERE id = p_pr_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase Request not found';
  END IF;
  IF v_pr.status <> 'draft' THEN
    RAISE EXCEPTION 'Items can only be edited while the PR is in draft (current: %)', v_pr.status;
  END IF;
  IF v_pr.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Cannot modify a PR outside your division';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  -- Soft-delete existing items so the uniqueness trigger sees a clean slate
  UPDATE procurements.pr_items
     SET deleted_at = NOW()
   WHERE purchase_request_id = p_pr_id
     AND deleted_at IS NULL;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_number := v_item_number + 1;
    v_app_item_id := NULLIF(v_item->>'app_item_id', '')::UUID;

    IF v_app_item_id IS NULL THEN
      RAISE EXCEPTION 'Line % is missing app_item_id', v_item_number;
    END IF;

    INSERT INTO procurements.pr_items (
      purchase_request_id, item_number, description, unit, quantity,
      estimated_unit_cost,
      ppmp_item_id, app_item_id, remarks, office_id
    ) VALUES (
      p_pr_id, v_item_number,
      v_item->>'description', v_item->>'unit',
      (v_item->>'quantity')::NUMERIC, (v_item->>'estimated_unit_cost')::NUMERIC,
      (SELECT source_ppmp_lot_id FROM procurements.app_items WHERE id = v_app_item_id),
      v_app_item_id,
      NULLIF(v_item->>'remarks', ''),
      v_pr.office_id
    );

    v_total_cost := v_total_cost
      + (v_item->>'quantity')::NUMERIC * (v_item->>'estimated_unit_cost')::NUMERIC;
  END LOOP;

  IF v_pr.abc_ceiling IS NOT NULL AND v_total_cost > v_pr.abc_ceiling THEN
    RAISE EXCEPTION 'Updated total (₱%) exceeds the ABC ceiling for % (₱%)',
      v_total_cost, v_pr.procurement_mode, v_pr.abc_ceiling;
  END IF;

  UPDATE procurements.purchase_requests
     SET total_estimated_cost = v_total_cost,
         updated_at           = NOW()
   WHERE id = p_pr_id;
END;
$$;

-- ============================================================
-- 3. Recreate check_split_contract() to join via pr_items.app_item_id
--    instead of the deprecated purchase_requests.app_item_id.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.check_split_contract(
  p_office_id   UUID,
  p_category    TEXT,
  p_amount      NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_threshold     NUMERIC;
  v_cumulative    NUMERIC := 0;
  v_pr_count      INTEGER := 0;
  v_division_id   UUID := procurements.get_user_division_id();
  v_fy_id         UUID;
BEGIN
  CASE p_category
    WHEN 'infrastructure'      THEN v_threshold := 5000000;
    WHEN 'consulting_services' THEN v_threshold := 1000000;
    ELSE                            v_threshold := 1000000;
  END CASE;

  SELECT id INTO v_fy_id
    FROM procurements.fiscal_years
   WHERE division_id = v_division_id
     AND status = 'active'
   LIMIT 1;

  IF v_fy_id IS NOT NULL THEN
    SELECT COALESCE(SUM(pr.total_estimated_cost), 0), COUNT(DISTINCT pr.id)
      INTO v_cumulative, v_pr_count
      FROM procurements.purchase_requests pr
     WHERE pr.office_id      = p_office_id
       AND pr.fiscal_year_id = v_fy_id
       AND pr.division_id    = v_division_id
       AND pr.status         NOT IN ('cancelled')
       AND pr.deleted_at     IS NULL
       AND EXISTS (
         SELECT 1
           FROM procurements.pr_items pi
           JOIN procurements.app_items ai ON ai.id = pi.app_item_id
          WHERE pi.purchase_request_id = pr.id
            AND pi.deleted_at  IS NULL
            AND ai.project_type = p_category
       );
  END IF;

  v_cumulative := v_cumulative + p_amount;

  RETURN jsonb_build_object(
    'warning',           v_cumulative > v_threshold,
    'cumulative_amount', v_cumulative,
    'threshold',         v_threshold,
    'pr_count',          v_pr_count
  );
END;
$$;

-- ============================================================
-- 4. Recreate create_purchase_request() WITHOUT writing to the
--    deprecated columns (step 2's version still set them).
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.create_purchase_request(
  p_office_id      UUID,
  p_fiscal_year_id UUID,
  p_purpose        TEXT,
  p_items          JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_division_id     UUID;
  v_user_office     UUID;
  v_pr_number       TEXT;
  v_pr_id           UUID;
  v_total_cost      NUMERIC := 0;
  v_item            JSONB;
  v_idx             INT := 0;
  v_app_item        RECORD;
  v_first_app_item  RECORD;
  v_first_alloc     RECORD;
  v_fund_src_id     UUID := NULL;
  v_mode            TEXT;
  v_unified_mode    TEXT;
  v_ceiling         NUMERIC(15,2);
  v_app_item_id     UUID;
  v_row_total       NUMERIC;
  v_seen_app_items  UUID[] := ARRAY[]::UUID[];
BEGIN
  v_division_id := procurements.get_user_division_id();
  SELECT office_id INTO v_user_office FROM procurements.user_profiles WHERE id = auth.uid();

  IF v_division_id IS NULL THEN
    RAISE EXCEPTION 'User has no division assigned';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := v_idx + 1;
    v_app_item_id := NULLIF(v_item->>'app_item_id', '')::UUID;

    IF v_app_item_id IS NULL THEN
      RAISE EXCEPTION 'Line % is missing app_item_id', v_idx;
    END IF;

    IF v_app_item_id = ANY(v_seen_app_items) THEN
      RAISE EXCEPTION 'Duplicate APP item in PR (line %)', v_idx;
    END IF;
    v_seen_app_items := array_append(v_seen_app_items, v_app_item_id);

    SELECT
      ai.*,
      a.status            AS app_status,
      a.indicative_final  AS app_indicative_final
    INTO v_app_item
    FROM procurements.app_items ai
    JOIN procurements.apps a ON a.id = ai.app_id
    WHERE ai.id          = v_app_item_id
      AND ai.deleted_at  IS NULL
      AND a.deleted_at   IS NULL
      AND a.division_id  = v_division_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'APP item % (line %) not found or not accessible', v_app_item_id, v_idx;
    END IF;

    IF v_app_item.app_status NOT IN ('approved', 'posted') THEN
      RAISE EXCEPTION 'Line % references an APP item from an APP that is not approved (status: %)',
        v_idx, v_app_item.app_status;
    END IF;

    IF NOT procurements.has_permission('ppmp.view_all') THEN
      IF v_app_item.source_office_id IS NOT NULL
         AND v_app_item.source_office_id <> v_user_office THEN
        RAISE EXCEPTION 'Line % references an APP item from another office. You can only PR for items from your own office.', v_idx;
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM procurements.pr_items pi
        JOIN procurements.purchase_requests pr ON pr.id = pi.purchase_request_id
       WHERE pi.app_item_id = v_app_item_id
         AND pi.deleted_at  IS NULL
         AND pr.deleted_at  IS NULL
         AND pr.status      <> 'cancelled'
    ) THEN
      RAISE EXCEPTION 'APP item on line % is already in another active Purchase Request', v_idx;
    END IF;

    v_mode := LOWER(TRIM(COALESCE(v_app_item.procurement_mode, '')));
    v_mode := CASE
      WHEN v_mode IN ('small value procurement', 'svp') THEN 'svp'
      WHEN v_mode IN ('public bidding', 'competitive bidding', 'bidding') THEN 'competitive_bidding'
      ELSE v_mode
    END;

    IF v_mode = '' THEN
      RAISE EXCEPTION 'APP item on line % has no procurement_mode set', v_idx;
    END IF;

    IF v_unified_mode IS NULL THEN
      v_unified_mode := v_mode;
      v_first_app_item := v_app_item;
    ELSIF v_unified_mode <> v_mode THEN
      RAISE EXCEPTION 'All items in a Purchase Request must share the same procurement mode (line 1 is %, line % is %)',
        v_unified_mode, v_idx, v_mode;
    END IF;

    v_row_total := (v_item->>'quantity')::NUMERIC * (v_item->>'estimated_unit_cost')::NUMERIC;
    IF v_row_total > v_app_item.estimated_budget::NUMERIC THEN
      RAISE EXCEPTION 'Line % total (₱%) exceeds the APP item budget (₱%)',
        v_idx, v_row_total, v_app_item.estimated_budget;
    END IF;

    v_total_cost := v_total_cost + v_row_total;
  END LOOP;

  SELECT ceiling_amount INTO v_ceiling
    FROM procurements.procurement_method_ceilings
   WHERE procurement_mode = v_unified_mode;

  IF v_ceiling IS NOT NULL AND v_total_cost > v_ceiling THEN
    RAISE EXCEPTION 'Bundled total (₱%) exceeds the ABC ceiling for % (₱%). Use a different procurement method.',
      v_total_cost, v_unified_mode, v_ceiling;
  END IF;

  IF v_first_app_item.budget_allocation_id IS NOT NULL THEN
    SELECT ba.fund_source_id, ba.adjusted_amount, ba.obligated_amount
      INTO v_first_alloc
      FROM procurements.budget_allocations ba
     WHERE ba.id = v_first_app_item.budget_allocation_id
       AND ba.deleted_at IS NULL;

    IF FOUND THEN
      v_fund_src_id := v_first_alloc.fund_source_id;
      IF (v_first_alloc.adjusted_amount::NUMERIC - v_first_alloc.obligated_amount::NUMERIC) < v_total_cost THEN
        RAISE EXCEPTION 'Insufficient budget. Available: ₱%, Requested: ₱%',
          (v_first_alloc.adjusted_amount::NUMERIC - v_first_alloc.obligated_amount::NUMERIC),
          v_total_cost;
      END IF;
    END IF;
  END IF;

  v_pr_number := procurements.generate_pr_number(p_office_id, p_fiscal_year_id, v_division_id);

  INSERT INTO procurements.purchase_requests (
    division_id, pr_number, office_id, fiscal_year_id, purpose,
    requested_by, requested_at,
    fund_source_id, budget_allocation_id,
    procurement_mode, abc_ceiling,
    total_estimated_cost, status, created_by
  ) VALUES (
    v_division_id, v_pr_number, p_office_id, p_fiscal_year_id, p_purpose,
    auth.uid(), NOW(),
    v_fund_src_id, v_first_app_item.budget_allocation_id,
    v_unified_mode, v_ceiling,
    v_total_cost, 'draft', auth.uid()
  )
  RETURNING id INTO v_pr_id;

  v_idx := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := v_idx + 1;
    v_app_item_id := (v_item->>'app_item_id')::UUID;

    INSERT INTO procurements.pr_items (
      purchase_request_id, item_number, description, unit, quantity,
      estimated_unit_cost,
      ppmp_item_id, app_item_id, remarks, office_id
    ) VALUES (
      v_pr_id,
      COALESCE((v_item->>'item_number')::INT, v_idx),
      v_item->>'description',
      v_item->>'unit',
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'estimated_unit_cost')::NUMERIC,
      (SELECT source_ppmp_lot_id FROM procurements.app_items WHERE id = v_app_item_id),
      v_app_item_id,
      NULLIF(v_item->>'remarks', ''),
      p_office_id
    );
  END LOOP;

  RETURN v_pr_id;
END;
$$;

-- ============================================================
-- 5. Drop the deprecated columns
-- ============================================================
ALTER TABLE procurements.purchase_requests
  DROP COLUMN IF EXISTS app_item_id,
  DROP COLUMN IF EXISTS ppmp_item_id,
  DROP COLUMN IF EXISTS lot_id;
