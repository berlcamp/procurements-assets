-- ============================================================
-- Line-level lotting for BAC lots
--
-- Until now an app_item (= one PPMP lot) could only be assigned to a BAC lot
-- as a whole group. The BAC needs to place an *individual* line item
-- (procurements.ppmp_lot_items) into a lot.
--
-- Approach: split-on-assign. app_items gains `source_ppmp_lot_item_ids`, the
-- subset of its source PPMP lot's line items that the row covers
-- (NULL = all lines, the pre-existing behaviour). Assigning a subset splits the
-- app_item in two: a new row carrying only the selected lines goes into the lot,
-- the original keeps the remainder. Unassigning merges the row back into its
-- unlotted sibling so repeated assign/unassign cycles don't fragment the pool.
--
-- Budgets are apportioned proportionally to the selected lines'
-- estimated_total_cost so the sum across the split rows exactly equals the
-- original estimated_budget — app_versions.total_estimated_cost is unchanged.
-- ============================================================

-- ============================================================
-- 1. Schema
-- ============================================================
ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS source_ppmp_lot_item_ids UUID[];

COMMENT ON COLUMN procurements.app_items.source_ppmp_lot_item_ids IS
  'Subset of procurements.ppmp_lot_items (of source_ppmp_lot_id) this APP item covers. NULL = every line of the source PPMP lot.';

-- Merging split rows back together soft-deletes the absorbed row. The read
-- policy already hides soft-deleted items, but the manage policy did not — so
-- app.manage / app.hope_review / app.approve holders saw them as phantom rows
-- in the available-items pool. Align it with the read policy.
DROP POLICY IF EXISTS "division_admin_manage_app_items" ON procurements.app_items;

CREATE POLICY "division_admin_manage_app_items" ON procurements.app_items
  FOR ALL TO authenticated
  USING (
    app_id IN (
      SELECT id FROM procurements.apps
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
    AND deleted_at IS NULL
    AND (
      procurements.has_permission('app.manage')
      OR procurements.has_permission('app.hope_review')
      OR procurements.has_permission('app.approve')
      OR platform.is_super_admin()
    )
  );

-- ============================================================
-- 2. Helpers
-- ============================================================

-- Effective line items of an APP item, in PPMP display order.
CREATE OR REPLACE FUNCTION procurements.app_item_line_ids(p_app_item_id UUID)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT COALESCE(
    ai.source_ppmp_lot_item_ids,
    ARRAY(
      SELECT pli.id
        FROM procurements.ppmp_lot_items pli
       WHERE pli.ppmp_lot_id = ai.source_ppmp_lot_id
       ORDER BY pli.item_number, pli.created_at
    )
  )
  FROM procurements.app_items ai
  WHERE ai.id = p_app_item_id;
$$;

-- Share of p_budget attributable to p_selected out of p_all.
-- Proportional to line cost; falls back to line count when all lines cost zero.
CREATE OR REPLACE FUNCTION procurements.app_item_budget_share(
  p_budget   NUMERIC,
  p_all      UUID[],
  p_selected UUID[]
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_all_total NUMERIC := 0;
  v_sel_total NUMERIC := 0;
BEGIN
  IF p_budget IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_selected IS NULL OR array_length(p_selected, 1) IS NULL THEN
    RETURN 0;
  END IF;
  IF p_all IS NULL OR array_length(p_all, 1) IS NULL THEN
    RETURN p_budget;
  END IF;

  SELECT COALESCE(SUM(estimated_total_cost), 0) INTO v_all_total
    FROM procurements.ppmp_lot_items WHERE id = ANY(p_all);
  SELECT COALESCE(SUM(estimated_total_cost), 0) INTO v_sel_total
    FROM procurements.ppmp_lot_items WHERE id = ANY(p_selected);

  IF v_all_total > 0 THEN
    RETURN ROUND(p_budget * v_sel_total / v_all_total, 2);
  END IF;

  RETURN ROUND(
    p_budget * array_length(p_selected, 1)::NUMERIC / array_length(p_all, 1)::NUMERIC,
    2
  );
END;
$$;

-- Canonicalise a line subset: NULL when it covers every line of the PPMP lot.
CREATE OR REPLACE FUNCTION procurements.canonical_line_subset(
  p_ppmp_lot_id UUID,
  p_line_ids    UUID[]
)
RETURNS UUID[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_all UUID[];
BEGIN
  IF p_line_ids IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ARRAY(
    SELECT pli.id FROM procurements.ppmp_lot_items pli
     WHERE pli.ppmp_lot_id = p_ppmp_lot_id
     ORDER BY pli.item_number, pli.created_at
  ) INTO v_all;

  IF array_length(v_all, 1) IS NULL THEN
    RETURN p_line_ids;
  END IF;

  IF p_line_ids @> v_all THEN
    RETURN NULL;
  END IF;

  RETURN p_line_ids;
END;
$$;

-- Merge an unlotted APP item back into any unlotted sibling covering the same
-- PPMP lot, so the pool returns to its unsplit shape. Returns the surviving row.
CREATE OR REPLACE FUNCTION procurements.merge_unlotted_app_item(p_app_item_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_item     RECORD;
  v_sibling  RECORD;
  v_survivor UUID;
  v_absorbed UUID;
  v_union    UUID[];
BEGIN
  v_survivor := p_app_item_id;

  LOOP
    SELECT * INTO v_item
      FROM procurements.app_items
     WHERE id = v_survivor
       AND deleted_at IS NULL;

    IF NOT FOUND
       OR v_item.lot_id IS NOT NULL
       OR v_item.source_ppmp_lot_id IS NULL THEN
      RETURN v_survivor;
    END IF;

    SELECT * INTO v_sibling
      FROM procurements.app_items
     WHERE app_version_id     = v_item.app_version_id
       AND source_ppmp_lot_id = v_item.source_ppmp_lot_id
       AND hope_review_status = v_item.hope_review_status
       AND lot_id IS NULL
       AND deleted_at IS NULL
       AND id <> v_item.id
     ORDER BY item_number
     LIMIT 1;

    IF NOT FOUND THEN
      RETURN v_survivor;
    END IF;

    -- Lowest item_number wins so the merged row keeps its place in the APP.
    IF v_sibling.item_number < v_item.item_number THEN
      v_survivor := v_sibling.id;
      v_absorbed := v_item.id;
    ELSE
      v_survivor := v_item.id;
      v_absorbed := v_sibling.id;
    END IF;

    SELECT ARRAY(
      SELECT pli.id
        FROM procurements.ppmp_lot_items pli
       WHERE pli.ppmp_lot_id = v_item.source_ppmp_lot_id
         AND (pli.id = ANY(procurements.app_item_line_ids(v_item.id))
              OR pli.id = ANY(procurements.app_item_line_ids(v_sibling.id)))
       ORDER BY pli.item_number, pli.created_at
    ) INTO v_union;

    UPDATE procurements.app_items
       SET source_ppmp_lot_item_ids =
             procurements.canonical_line_subset(v_item.source_ppmp_lot_id, v_union),
           estimated_budget  = v_item.estimated_budget + v_sibling.estimated_budget,
           indicative_budget = CASE
             WHEN v_item.indicative_budget IS NULL AND v_sibling.indicative_budget IS NULL THEN NULL
             ELSE COALESCE(v_item.indicative_budget, 0) + COALESCE(v_sibling.indicative_budget, 0)
           END,
           updated_at = NOW()
     WHERE id = v_survivor;

    UPDATE procurements.app_items
       SET deleted_at = NOW(),
           updated_at = NOW()
     WHERE id = v_absorbed;
  END LOOP;
END;
$$;

-- Recalculate a lot's total from its currently assigned items.
CREATE OR REPLACE FUNCTION procurements.recalc_app_lot_total(p_lot_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_total NUMERIC(15,2);
BEGIN
  SELECT COALESCE(SUM(estimated_budget), 0) INTO v_total
    FROM procurements.app_items
   WHERE lot_id = p_lot_id
     AND deleted_at IS NULL;

  UPDATE procurements.app_lots
     SET total_estimated_cost = v_total,
         updated_at           = NOW()
   WHERE id = p_lot_id;
END;
$$;

-- ============================================================
-- 3. assign_lot_items_to_lot(p_lot_id, p_assignments)
--
-- p_assignments: [{"app_item_id": uuid, "ppmp_lot_item_ids": [uuid, ...]}, ...]
-- An empty/absent ppmp_lot_item_ids assigns the whole APP item.
-- Returns the number of line items assigned.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.assign_lot_items_to_lot(
  p_lot_id      UUID,
  p_assignments JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot           RECORD;
  v_item          RECORD;
  v_entry         JSONB;
  v_item_id       UUID;
  v_all           UUID[];
  v_selected      UUID[];
  v_remaining     UUID[];
  v_next_num      INTEGER;
  v_next_item_num INTEGER;
  v_share         NUMERIC(15,2);
  v_share_ind     NUMERIC(15,2);
  v_count         INTEGER := 0;
BEGIN
  SELECT al.*, a.division_id
    INTO v_lot
    FROM procurements.app_lots al
    JOIN procurements.apps a ON a.id = al.app_id
   WHERE al.id = p_lot_id
     AND al.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lot % not found', p_lot_id;
  END IF;

  IF v_lot.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Access denied to lot %', p_lot_id;
  END IF;

  IF NOT procurements.has_permission('app.bac_manage_lots') THEN
    RAISE EXCEPTION 'Insufficient permissions to manage lot items';
  END IF;

  IF v_lot.status = 'finalized' THEN
    RAISE EXCEPTION 'Cannot modify finalized lot %', p_lot_id;
  END IF;

  SELECT COALESCE(MAX(lot_item_number), 0)
    INTO v_next_num
    FROM procurements.app_items
   WHERE lot_id = p_lot_id;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::JSONB))
  LOOP
    v_item_id := NULLIF(v_entry->>'app_item_id', '')::UUID;

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Assignment entry is missing app_item_id';
    END IF;

    SELECT * INTO v_item
      FROM procurements.app_items
     WHERE id = v_item_id
       AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'APP item % not found', v_item_id;
    END IF;

    IF v_item.hope_review_status <> 'approved' THEN
      RAISE EXCEPTION 'Item % is not HOPE-approved (status: %). Only approved items can be assigned to lots.',
        v_item_id, v_item.hope_review_status;
    END IF;

    IF v_item.lot_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM procurements.app_lots
       WHERE id = v_item.lot_id AND status = 'finalized'
    ) THEN
      RAISE EXCEPTION 'Cannot move item % out of a finalized lot', v_item_id;
    END IF;

    IF v_item.procurement_mode IS NOT NULL
       AND v_item.procurement_mode <> v_lot.procurement_method THEN
      RAISE NOTICE 'Item % procurement mode (%) differs from lot method (%). Item assigned anyway.',
        v_item_id, v_item.procurement_mode, v_lot.procurement_method;
    END IF;

    v_all := procurements.app_item_line_ids(v_item_id);

    SELECT ARRAY(
      SELECT t.value::UUID
        FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(v_entry->'ppmp_lot_item_ids') = 'array'
                    THEN v_entry->'ppmp_lot_item_ids'
                    ELSE '[]'::JSONB
               END
             ) AS t(value)
    ) INTO v_selected;

    -- No subset given, the item has no line items, or the subset covers
    -- everything → move the whole APP item, exactly as before.
    IF array_length(v_selected, 1) IS NULL
       OR array_length(v_all, 1) IS NULL
       OR v_selected @> v_all THEN
      v_next_num := v_next_num + 1;

      UPDATE procurements.app_items
         SET lot_id          = p_lot_id,
             lot_item_number = v_next_num,
             updated_at      = NOW()
       WHERE id = v_item_id;

      v_count := v_count + COALESCE(array_length(v_all, 1), 1);
      CONTINUE;
    END IF;

    IF NOT (v_all @> v_selected) THEN
      RAISE EXCEPTION 'Selected line items do not all belong to APP item %', v_item_id;
    END IF;

    -- Partial selection → split the APP item.
    SELECT ARRAY(
      SELECT u FROM unnest(v_all) WITH ORDINALITY AS t(u, ord)
       WHERE NOT (u = ANY(v_selected))
       ORDER BY ord
    ) INTO v_remaining;

    v_share     := procurements.app_item_budget_share(v_item.estimated_budget, v_all, v_selected);
    v_share_ind := procurements.app_item_budget_share(v_item.indicative_budget, v_all, v_selected);

    SELECT COALESCE(MAX(item_number), 0) + 1
      INTO v_next_item_num
      FROM procurements.app_items
     WHERE app_version_id = v_item.app_version_id
       AND deleted_at IS NULL;

    v_next_num := v_next_num + 1;

    INSERT INTO procurements.app_items (
      app_version_id, app_id,
      source_ppmp_project_id, source_ppmp_lot_id, source_ppmp_id,
      source_ppmp_project_description, source_ppmp_lot_item_ids,
      item_number, general_description, project_type,
      procurement_mode, estimated_budget, indicative_budget, source_of_funds,
      procurement_start, procurement_end, delivery_period,
      budget_allocation_id, source_office_id, is_cse,
      schedule_quarter, advertisement_date, bid_opening_date,
      award_date, contract_signing_date,
      hope_review_status, hope_reviewed_by, hope_reviewed_at, hope_remarks,
      lot_id, lot_item_number, remarks, created_by
    ) VALUES (
      v_item.app_version_id, v_item.app_id,
      v_item.source_ppmp_project_id, v_item.source_ppmp_lot_id, v_item.source_ppmp_id,
      v_item.source_ppmp_project_description, v_selected,
      v_next_item_num, v_item.general_description, v_item.project_type,
      v_item.procurement_mode, v_share, v_share_ind, v_item.source_of_funds,
      v_item.procurement_start, v_item.procurement_end, v_item.delivery_period,
      v_item.budget_allocation_id, v_item.source_office_id, v_item.is_cse,
      v_item.schedule_quarter, v_item.advertisement_date, v_item.bid_opening_date,
      v_item.award_date, v_item.contract_signing_date,
      v_item.hope_review_status, v_item.hope_reviewed_by, v_item.hope_reviewed_at, v_item.hope_remarks,
      p_lot_id, v_next_num, v_item.remarks, v_item.created_by
    );

    UPDATE procurements.app_items
       SET source_ppmp_lot_item_ids = v_remaining,
           estimated_budget         = v_item.estimated_budget - v_share,
           indicative_budget        = CASE
             WHEN v_item.indicative_budget IS NULL THEN NULL
             ELSE v_item.indicative_budget - v_share_ind
           END,
           updated_at = NOW()
     WHERE id = v_item_id;

    v_count := v_count + array_length(v_selected, 1);
  END LOOP;

  PERFORM procurements.recalc_app_lot_total(p_lot_id);

  RETURN v_count;
END;
$$;

-- ============================================================
-- 4. assign_items_to_lot — thin wrapper, whole-item assignment
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.assign_items_to_lot(
  p_lot_id       UUID,
  p_app_item_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_assignments JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('app_item_id', id)), '[]'::JSONB)
    INTO v_assignments
    FROM unnest(COALESCE(p_app_item_ids, ARRAY[]::UUID[])) AS id;

  PERFORM procurements.assign_lot_items_to_lot(p_lot_id, v_assignments);

  RETURN COALESCE(array_length(p_app_item_ids, 1), 0);
END;
$$;

-- ============================================================
-- 5. unassign_lot_items(p_app_item_id, p_ppmp_lot_item_ids)
--
-- Removes specific line items from their lot. NULL/empty removes the whole
-- APP item. Returns the number of line items removed.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.unassign_lot_items(
  p_app_item_id       UUID,
  p_ppmp_lot_item_ids UUID[] DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_item          RECORD;
  v_all           UUID[];
  v_selected      UUID[];
  v_remaining     UUID[];
  v_lot_id        UUID;
  v_next_item_num INTEGER;
  v_new_id        UUID;
  v_share         NUMERIC(15,2);
  v_share_ind     NUMERIC(15,2);
BEGIN
  SELECT ai.*, a.division_id
    INTO v_item
    FROM procurements.app_items ai
    JOIN procurements.apps a ON a.id = ai.app_id
   WHERE ai.id = p_app_item_id
     AND ai.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF v_item.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF v_item.lot_id IS NULL THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM procurements.app_lots
     WHERE id = v_item.lot_id AND status = 'finalized'
  ) THEN
    RAISE EXCEPTION 'Cannot remove item from finalized lot';
  END IF;

  v_lot_id := v_item.lot_id;
  v_all    := procurements.app_item_line_ids(p_app_item_id);

  SELECT ARRAY(
    SELECT u FROM unnest(COALESCE(p_ppmp_lot_item_ids, ARRAY[]::UUID[])) AS u
     WHERE u = ANY(COALESCE(v_all, ARRAY[]::UUID[]))
  ) INTO v_selected;

  -- Whole-item removal.
  IF array_length(v_selected, 1) IS NULL
     OR array_length(v_all, 1) IS NULL
     OR v_selected @> v_all THEN
    UPDATE procurements.app_items
       SET lot_id          = NULL,
           lot_item_number = NULL,
           updated_at      = NOW()
     WHERE id = p_app_item_id;

    PERFORM procurements.merge_unlotted_app_item(p_app_item_id);
    PERFORM procurements.recalc_app_lot_total(v_lot_id);

    RETURN COALESCE(array_length(v_all, 1), 1);
  END IF;

  -- Partial removal → split the lotted item, the removed lines go back to the pool.
  SELECT ARRAY(
    SELECT u FROM unnest(v_all) WITH ORDINALITY AS t(u, ord)
     WHERE NOT (u = ANY(v_selected))
     ORDER BY ord
  ) INTO v_remaining;

  v_share     := procurements.app_item_budget_share(v_item.estimated_budget, v_all, v_selected);
  v_share_ind := procurements.app_item_budget_share(v_item.indicative_budget, v_all, v_selected);

  SELECT COALESCE(MAX(item_number), 0) + 1
    INTO v_next_item_num
    FROM procurements.app_items
   WHERE app_version_id = v_item.app_version_id
     AND deleted_at IS NULL;

  INSERT INTO procurements.app_items (
    app_version_id, app_id,
    source_ppmp_project_id, source_ppmp_lot_id, source_ppmp_id,
    source_ppmp_project_description, source_ppmp_lot_item_ids,
    item_number, general_description, project_type,
    procurement_mode, estimated_budget, indicative_budget, source_of_funds,
    procurement_start, procurement_end, delivery_period,
    budget_allocation_id, source_office_id, is_cse,
    schedule_quarter, advertisement_date, bid_opening_date,
    award_date, contract_signing_date,
    hope_review_status, hope_reviewed_by, hope_reviewed_at, hope_remarks,
    lot_id, lot_item_number, remarks, created_by
  ) VALUES (
    v_item.app_version_id, v_item.app_id,
    v_item.source_ppmp_project_id, v_item.source_ppmp_lot_id, v_item.source_ppmp_id,
    v_item.source_ppmp_project_description, v_selected,
    v_next_item_num, v_item.general_description, v_item.project_type,
    v_item.procurement_mode, v_share, v_share_ind, v_item.source_of_funds,
    v_item.procurement_start, v_item.procurement_end, v_item.delivery_period,
    v_item.budget_allocation_id, v_item.source_office_id, v_item.is_cse,
    v_item.schedule_quarter, v_item.advertisement_date, v_item.bid_opening_date,
    v_item.award_date, v_item.contract_signing_date,
    v_item.hope_review_status, v_item.hope_reviewed_by, v_item.hope_reviewed_at, v_item.hope_remarks,
    NULL, NULL, v_item.remarks, v_item.created_by
  )
  RETURNING id INTO v_new_id;

  UPDATE procurements.app_items
     SET source_ppmp_lot_item_ids = v_remaining,
         estimated_budget         = v_item.estimated_budget - v_share,
         indicative_budget        = CASE
           WHEN v_item.indicative_budget IS NULL THEN NULL
           ELSE v_item.indicative_budget - v_share_ind
         END,
         updated_at = NOW()
   WHERE id = p_app_item_id;

  PERFORM procurements.merge_unlotted_app_item(v_new_id);
  PERFORM procurements.recalc_app_lot_total(v_lot_id);

  RETURN array_length(v_selected, 1);
END;
$$;

-- ============================================================
-- 6. unassign_items_from_lot — whole-item removal, now merging back
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.unassign_items_from_lot(
  p_app_item_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_item_id UUID;
  v_count   INTEGER := 0;
BEGIN
  FOREACH v_item_id IN ARRAY COALESCE(p_app_item_ids, ARRAY[]::UUID[]) LOOP
    IF procurements.unassign_lot_items(v_item_id, NULL) > 0 THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
