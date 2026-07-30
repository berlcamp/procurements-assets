-- ============================================================
-- Two-gate lot model.
--
-- 'finalized' conflated two decisions:
--   composed  - packaging locked; required BEFORE the APP can be final
--   released  - ABC fixed and biddable; allowed only AFTER the Final
--               APP is approved, or under a flagged EPA
--
-- The old ordering (lots finalized -> APP final) contradicted the rule that
-- lotting is only settled once the Final APP exists. Splitting the states makes
-- both true at once.
--
-- RETIRING AN ENUM VALUE IS NOT A LOCAL CHANGE. 'finalized' was read by six
-- live routines, not the two this migration replaces. Section 8 sweeps the
-- other four; without it the amendment guard added in 20260809 would silently
-- fail OPEN and composed lots would become editable again, undoing 20260806.
-- Any future migration that retires a CHECK value must do the same sweep:
--   grep -rn "'<value>'" supabase/migrations/*.sql
-- and then resolve each hit to the LIVE definition of its owning function.
--
-- P2 (backfill vs. trigger) audited and CLEAN: procurements.app_lots carries no
-- triggers at all -- not updated_at, not audit -- so the two remaps below fire
-- nothing and cascade nowhere. Verified against every CREATE TRIGGER in the
-- tree, not assumed.
-- ============================================================

ALTER TABLE procurements.app_lots
  ADD COLUMN IF NOT EXISTS is_early_procurement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS epa_authorized_by  UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS epa_authorized_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS epa_justification  TEXT,
  ADD COLUMN IF NOT EXISTS released_by        UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS released_at        TIMESTAMPTZ;

COMMENT ON COLUMN procurements.app_lots.is_early_procurement IS
  'Early Procurement Activity: this lot may be bid and awarded on an indicative APP. Contract signing still requires an enacted appropriation.';
COMMENT ON COLUMN procurements.app_lots.finalized_by IS
  'Who locked lot composition (draft -> composed). Retained name; semantics are composition, not release.';
COMMENT ON COLUMN procurements.app_lots.finalized_at IS
  'When lot composition was locked (draft -> composed). Retained name; see finalized_by.';
COMMENT ON COLUMN procurements.app_lots.released_by IS
  'Who released the lot for bidding (composed -> released).';
COMMENT ON COLUMN procurements.app_lots.released_at IS
  'When the lot was released for bidding (composed -> released).';

-- ============================================================
-- 1. Retire 'finalized' from the CHECK, then remap.
--
-- ORDER IS LOAD-BEARING AND IS THE REVERSE OF THE OBVIOUS ONE. The remap writes
-- 'composed' and 'released', neither of which the OLD constraint admits, so
-- remapping first aborts on the very first row with a check violation. The
-- constraint must be dropped BEFORE the data moves and re-added after.
-- ============================================================

ALTER TABLE procurements.app_lots
  DROP CONSTRAINT IF EXISTS app_lots_status_check;

-- A lot under an already-approved APP was effectively released.
UPDATE procurements.app_lots al
   SET status      = 'released',
       released_by = al.finalized_by,
       released_at = al.finalized_at
  FROM procurements.app_versions av
 WHERE av.id = al.app_version_id
   AND al.status = 'finalized'
   AND av.status = 'approved';

-- Everything else that was 'finalized' is composition-locked only.
UPDATE procurements.app_lots
   SET status = 'composed'
 WHERE status = 'finalized';

ALTER TABLE procurements.app_lots
  ADD CONSTRAINT app_lots_status_check
  CHECK (status IN ('draft','composed','released','in_procurement'));

-- NOTE ON HISTORY: trg_snapshot_approved_app_version (20240604_app_triggers.sql:117)
-- stores row_to_json of each lot -- including status -- into
-- app_versions.snapshot_data when a version is approved. Snapshots taken before
-- this migration therefore still read "finalized". That is correct and is
-- deliberately NOT rewritten: the snapshot is the record of what was approved at
-- the time, and editing it would falsify the legal record.

CREATE INDEX IF NOT EXISTS idx_app_lots_status ON procurements.app_lots(status);
CREATE INDEX IF NOT EXISTS idx_app_lots_epa
  ON procurements.app_lots(is_early_procurement)
  WHERE is_early_procurement = true;

-- ============================================================
-- 2. Permissions
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('app.release_lots',  'planning',
   'Release composed lots for bidding once the Final APP is approved', 'division'),
  ('app.authorize_epa', 'planning',
   'Authorize Early Procurement Activity on an indicative APP lot',    'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('bac_chair','bac_secretariat','division_admin')
  AND p.code IN ('app.release_lots')
ON CONFLICT DO NOTHING;

-- EPA is a HOPE-level decision: it commits the division to bidding
-- against money that does not legally exist yet.
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('hope','division_admin')
  AND p.code IN ('app.authorize_epa')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Gate 1a: compose (draft -> composed). Formerly finalize_lot.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.finalize_lot(
  p_lot_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot      RECORD;
  v_item_cnt INTEGER;
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
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT procurements.has_permission('app.bac_finalize_lot') THEN
    RAISE EXCEPTION 'Insufficient permissions to compose lots';
  END IF;

  IF v_lot.status <> 'draft' THEN
    RAISE EXCEPTION
      'Only draft lots can be composed (lot % is %). Composition is already locked.',
      p_lot_id, v_lot.status;
  END IF;

  SELECT COUNT(*) INTO v_item_cnt
    FROM procurements.app_items
   WHERE lot_id = p_lot_id
     AND deleted_at IS NULL;

  IF v_item_cnt = 0 THEN
    RAISE EXCEPTION 'Cannot compose an empty lot. Assign at least one item.';
  END IF;

  IF v_lot.procurement_method IS NULL OR LENGTH(TRIM(v_lot.procurement_method)) = 0 THEN
    RAISE EXCEPTION
      'Lot % needs a procurement method before composition can be locked.', p_lot_id;
  END IF;

  UPDATE procurements.app_lots
     SET status       = 'composed',
         finalized_by = auth.uid(),
         finalized_at = NOW(),
         updated_at   = NOW()
   WHERE id = p_lot_id;
END;
$$;

COMMENT ON FUNCTION procurements.finalize_lot(UUID) IS
  'Gate 1a: locks lot composition (draft -> composed). Required before finalize_app(). Does NOT make the lot biddable -- that is release_app_lot().';

-- ============================================================
-- 4. Gate 1b: authorize EPA on an indicative APP lot.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.authorize_epa_lot(
  p_lot_id        UUID,
  p_justification TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot   RECORD;
  v_ver   RECORD;
  v_actor UUID;
BEGIN
  IF p_justification IS NULL OR LENGTH(TRIM(p_justification)) < 20 THEN
    RAISE EXCEPTION
      'An EPA authorization needs a written justification of at least 20 characters.';
  END IF;

  SELECT al.*, a.division_id, a.status AS app_status
    INTO v_lot
    FROM procurements.app_lots al
    JOIN procurements.apps a ON a.id = al.app_id
   WHERE al.id = p_lot_id
     AND al.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lot % not found', p_lot_id;
  END IF;

  IF v_lot.division_id <> procurements.get_user_division_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT procurements.has_permission('app.authorize_epa') THEN
    RAISE EXCEPTION
      'Authorizing Early Procurement Activity requires the app.authorize_epa permission (HOPE).';
  END IF;

  SELECT * INTO v_ver
    FROM procurements.app_versions
   WHERE id = v_lot.app_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP version % for lot % not found', v_lot.app_version_id, p_lot_id;
  END IF;

  -- EPA only makes sense on an APP that is approved but not yet final.
  IF v_ver.status <> 'approved' THEN
    RAISE EXCEPTION
      'EPA can only be authorized on an approved APP version (current: %).', v_ver.status;
  END IF;

  -- IS DISTINCT FROM, not <>. planning_stage is NULLABLE -- 20260802's
  -- date-aware backfill deliberately leaves it NULL where no budget ceiling
  -- qualified. `NULL <> 'indicative'` evaluates to NULL, plpgsql treats a NULL
  -- IF as false, and the guard would silently pass: EPA authorized against a
  -- version whose stage nobody knows. Fail closed on unknown instead.
  IF v_ver.planning_stage IS DISTINCT FROM 'indicative' THEN
    RAISE EXCEPTION
      'EPA is only for indicative APPs. This version is %, so release the lot normally.',
      COALESCE(v_ver.planning_stage, 'of unknown planning stage');
  END IF;

  IF v_lot.status <> 'composed' THEN
    RAISE EXCEPTION
      'Lot must be composed before EPA authorization (current: %).', v_lot.status;
  END IF;

  -- approval_logs.acted_by is NOT NULL (20240311_approval_logs.sql:9). The
  -- division check above already makes a NULL uid unreachable, since
  -- get_user_division_id() returns NULL without a JWT and app_lots.division_id
  -- is NOT NULL. This exists so that if that gate is ever loosened the failure
  -- is this sentence rather than a bare not-null violation on an audit table.
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Cannot authorize EPA without an authenticated user (auth.uid() is NULL).';
  END IF;

  UPDATE procurements.app_lots
     SET is_early_procurement = true,
         epa_authorized_by    = v_actor,
         epa_authorized_at    = NOW(),
         epa_justification    = p_justification,
         updated_at           = NOW()
   WHERE id = p_lot_id;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks
  ) VALUES (
    'app_lot', p_lot_id, 'EPA Authorization', 1,
    'approved', v_actor,
    'Early Procurement Activity authorized on an indicative APP. '
      || 'Contract signing remains blocked until the appropriation exists. '
      || 'Justification: ' || p_justification
  );
END;
$$;

COMMENT ON FUNCTION procurements.authorize_epa_lot(UUID, TEXT) IS
  'Gate 1b: flags a composed lot on an approved INDICATIVE APP as an Early Procurement Activity, letting it be released for bidding before the GAA. Contract signing stays blocked until the appropriation exists.';

-- ============================================================
-- 5. Gate 1c: release (composed -> released).
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.release_app_lot(
  p_lot_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot        RECORD;
  v_ver        RECORD;
  v_releasable BOOLEAN;
  v_actor      UUID;
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
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF NOT procurements.has_permission('app.release_lots') THEN
    RAISE EXCEPTION 'Insufficient permissions to release lots for bidding';
  END IF;

  IF v_lot.status = 'released' THEN
    RAISE EXCEPTION 'Lot % is already released', p_lot_id;
  END IF;

  IF v_lot.status <> 'composed' THEN
    RAISE EXCEPTION
      'Only composed lots can be released (lot % is %).', p_lot_id, v_lot.status;
  END IF;

  SELECT * INTO v_ver
    FROM procurements.app_versions
   WHERE id = v_lot.app_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APP version % for lot % not found', v_lot.app_version_id, p_lot_id;
  END IF;

  -- The rule: a lot becomes biddable only on an approved Final APP, unless it
  -- carries an explicit EPA authorization.
  --
  -- COALESCE is load-bearing. planning_stage is NULLABLE (20260802 leaves it
  -- NULL where no ceiling qualified), and `NULL IN ('final','supplemental')` is
  -- NULL, so the whole conjunction goes NULL and `IF NOT NULL THEN` is treated
  -- as false -- the guard would not fire and an unknown-stage lot would be
  -- released with no EPA at all. Unknown must read as "not final", never as
  -- "final".
  v_releasable := COALESCE(v_ver.planning_stage IN ('final','supplemental'), false)
                  AND v_ver.status = 'approved';

  IF NOT v_releasable THEN
    IF NOT v_lot.is_early_procurement THEN
      RAISE EXCEPTION
        'Lot % cannot be released: its APP version is % / %. '
        'Lots become biddable only on an approved Final APP. '
        'For pre-GAA procurement, authorize EPA on this lot first '
        '(authorize_epa_lot), which keeps contract signing blocked until '
        'the appropriation exists.',
        p_lot_id, COALESCE(v_ver.planning_stage, 'unknown stage'), v_ver.status;
    END IF;

    IF v_lot.epa_authorized_by IS NULL THEN
      RAISE EXCEPTION
        'Lot % is flagged for EPA but has no recorded authorization. '
        'Run authorize_epa_lot() first.', p_lot_id;
    END IF;
  END IF;

  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Cannot release a lot without an authenticated user (auth.uid() is NULL).';
  END IF;

  UPDATE procurements.app_lots
     SET status      = 'released',
         released_by = v_actor,
         released_at = NOW(),
         updated_at  = NOW()
   WHERE id = p_lot_id;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks
  ) VALUES (
    'app_lot', p_lot_id, 'Lot Release', 2,
    'approved', v_actor,
    CASE WHEN v_lot.is_early_procurement
         THEN 'Released under Early Procurement Activity.'
         ELSE 'Released against approved Final APP.' END
  );
END;
$$;

COMMENT ON FUNCTION procurements.release_app_lot(UUID) IS
  'Gate 1c: makes a composed lot biddable (composed -> released). Requires an approved APP version whose planning_stage is final or supplemental, OR an EPA authorization on the lot. A NULL planning_stage is treated as not-final.';

CREATE OR REPLACE FUNCTION procurements.release_all_app_lots(
  p_app_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_lot_id UUID;
  v_count  INTEGER := 0;
BEGIN
  -- ALL OR NOTHING, deliberately. Each iteration calls release_app_lot, which
  -- re-checks division, permission and the release gate. There is no
  -- subtransaction here, so an ineligible lot aborts the whole call rather than
  -- being skipped. That is the intended behaviour: silently releasing a subset
  -- and returning a count would leave the caller believing the APP was fully
  -- released. On an approved Final APP every composed lot qualifies, which is
  -- the case this is for.
  FOR v_lot_id IN
    SELECT al.id
      FROM procurements.app_lots al
      JOIN procurements.app_versions av ON av.id = al.app_version_id
     WHERE al.app_id = p_app_id
       AND al.deleted_at IS NULL
       AND al.status = 'composed'
       AND av.status = 'approved'
     ORDER BY al.lot_number
  LOOP
    PERFORM procurements.release_app_lot(v_lot_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION procurements.release_all_app_lots(UUID) IS
  'Bulk release of every composed lot under an approved APP version. All-or-nothing: one ineligible lot aborts the call.';

-- ============================================================
-- 6. finalize_app: require COMPOSITION, not release.
--
-- Body copied verbatim from the live definition
-- (20260803_stop_stage_writes_from_workflow.sql:115-216 -- confirmed live: it
-- is the last file in the tree defining finalize_app). Only the lot gate
-- changed; every other line, including Task 4's indicative_final removal, is
-- byte-identical to that source.
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

  -- All lots must have their composition locked (two-gate model, 20260810).
  SELECT COUNT(*) INTO v_unfinal_lot
    FROM procurements.app_lots
   WHERE app_version_id = v_version_id
     AND deleted_at IS NULL
     AND status = 'draft';

  IF v_unfinal_lot > 0 THEN
    RAISE EXCEPTION
      'Cannot finalize APP: % lots are still in draft. Lock their composition first (finalize_lot).',
      v_unfinal_lot;
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
     SET status               = 'final',
         total_estimated_cost = v_total
   WHERE id = v_version_id;

  UPDATE procurements.apps
     SET status     = 'final',
         updated_at = NOW()
   WHERE id = p_app_id;
END;
$$;

-- ============================================================
-- 7. THE SWEEP -- the four remaining live readers of 'finalized'.
--
-- Each body below is copied verbatim from its LIVE definition and differs from
-- it ONLY in the status predicate (and the comments describing that predicate).
-- Sources, each confirmed by resolving the function name to the last migration
-- that defines it:
--   assign_lot_items_to_lot     20260729_app_item_line_level_lotting.sql:266-446
--   unassign_lot_items          20260729_app_item_line_level_lotting.sql:479-607
--   get_app_summary             20240603_app_rpc.sql:552-611
--   ppmp_has_inflight_procurement 20260809_amendment_guards.sql:136-261
--
-- Mapping used, and why each differs:
--   * The two lotting guards asked "is composition locked?" -> `<> 'draft'`.
--     Stated negatively so a fifth status added later cannot slip past them.
--   * get_app_summary's finalized_lots counted "locked but not yet in
--     procurement" -> IN ('composed','released'), the exact image of the old
--     value under the split. The RETURNS TABLE column keeps its name: renaming
--     it needs DROP+CREATE and breaks src/types/database.ts. Its MEANING is
--     unchanged, so no caller is misled.
--   * ppmp_has_inflight_procurement asked "is this biddable?" -> 'released'
--     only. NOT 'composed' -- see the comment in its body.
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

  -- Two-gate model (20260810): 'finalized' was split into 'composed' and
  -- 'released'. Composition is locked the moment a lot leaves 'draft', so the
  -- guard is stated as <> 'draft' and cannot be missed by a future state.
  IF v_lot.status <> 'draft' THEN
    RAISE EXCEPTION 'Cannot modify lot % — its composition is locked (status: %).',
      p_lot_id, v_lot.status;
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
       WHERE id = v_item.lot_id AND status <> 'draft'
    ) THEN
      RAISE EXCEPTION 'Cannot move item % out of a lot whose composition is locked', v_item_id;
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
     WHERE id = v_item.lot_id AND status <> 'draft'
  ) THEN
    RAISE EXCEPTION 'Cannot remove item from a lot whose composition is locked';
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
CREATE OR REPLACE FUNCTION procurements.get_app_summary(
  p_app_id UUID
)
RETURNS TABLE (
  total_items       BIGINT,
  pending_items     BIGINT,
  approved_items    BIGINT,
  remarked_items    BIGINT,
  lotted_items      BIGINT,
  unlotted_items    BIGINT,
  total_lots        BIGINT,
  finalized_lots    BIGINT,
  draft_lots        BIGINT,
  total_budget      NUMERIC(15,2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_version_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM procurements.apps
     WHERE id = p_app_id
       AND division_id = procurements.get_user_division_id()
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'APP % not found or access denied', p_app_id;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.app_versions
   WHERE app_id = p_app_id
   ORDER BY version_number DESC
   LIMIT 1;

  RETURN QUERY
  SELECT
    COUNT(*)                                                        AS total_items,
    COUNT(*) FILTER (WHERE ai.hope_review_status = 'pending')       AS pending_items,
    COUNT(*) FILTER (WHERE ai.hope_review_status = 'approved')      AS approved_items,
    COUNT(*) FILTER (WHERE ai.hope_review_status = 'remarked')      AS remarked_items,
    COUNT(*) FILTER (WHERE ai.lot_id IS NOT NULL)                   AS lotted_items,
    COUNT(*) FILTER (WHERE ai.lot_id IS NULL AND ai.hope_review_status = 'approved') AS unlotted_items,
    (SELECT COUNT(*) FROM procurements.app_lots
      WHERE app_version_id = v_version_id AND deleted_at IS NULL)   AS total_lots,
    (SELECT COUNT(*) FROM procurements.app_lots
      WHERE app_version_id = v_version_id AND deleted_at IS NULL
        AND status IN ('composed','released'))                      AS finalized_lots,
    (SELECT COUNT(*) FROM procurements.app_lots
      WHERE app_version_id = v_version_id AND deleted_at IS NULL
        AND status = 'draft')                                       AS draft_lots,
    COALESCE(SUM(ai.estimated_budget), 0)                           AS total_budget
  FROM procurements.app_items ai
  WHERE ai.app_version_id = v_version_id
    AND ai.deleted_at IS NULL;
END;
$$;
CREATE OR REPLACE FUNCTION procurements.ppmp_has_inflight_procurement(
  p_ppmp_id UUID
)
RETURNS TABLE (
  app_item_id         UUID,
  item_number         INTEGER,
  general_description TEXT,
  reason              TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  -- (a) Items sitting in a lot that has moved past composition, IN AN APP
  --     VERSION THE AMENDMENT WOULD ACTUALLY EDIT.
  --
  --     app_lots.status CHECK is now
  --     ('draft','composed','released','in_procurement') (20260810). The
  --     two-gate split retired 'finalized', which had meant "biddable".
  --     Its successor here is 'released', NOT 'composed': a composed lot is
  --     packaging-locked but not yet biddable, so amending it orphans no
  --     procurement and blocking it would be a false positive of exactly the
  --     operational-dead-end kind this arm was already fixed for once.
  --
  --     VERSION SCOPING, load-bearing. The soft-delete this arm predicts is
  --     version-scoped: auto_populate_app_from_ppmp deletes only
  --     `WHERE app_version_id = v_app_version_id AND source_ppmp_id = NEW.id`
  --     (20260405_ppmp_app_amendment_logic.sql:166-172). Without the
  --     app_versions join this arm matched EVERY version's copy of the item.
  --     That matters because create_app_amendment
  --     (20260803_stop_stage_writes_from_workflow.sql:430-473) clones items
  --     into a new version WITHOUT soft-deleting the originals, and the old
  --     version's lots keep a past-composition status. So after the first APP
  --     amendment of a fiscal year, every PPMP that fed the old version tripped
  --     this arm on a row the trigger will never touch -- and the remedy the
  --     error message offers ("cancel those activities") is impossible, because
  --     a lot in a closed version cannot be un-composed. It failed CLOSED, so
  --     it was not a safety hole, but it silently made ordinary PPMP amendment
  --     an override-only operation.
  --
  --     Predicate: app_versions.status CHECK admits
  --     ('draft','under_review','bac_finalization','final','approved',
  --     'superseded') (20240601_app_tables.sql:45-46).
  --
  --     THIS PREDICATE MIRRORS THE TRIGGER'S EDITABLE-VERSION LOOKUP EXACTLY.
  --     auto_populate_app_from_ppmp resolves the version it will edit with
  --     `AND status NOT IN ('final', 'approved', 'superseded')`
  --     (20260808_consolidation_visibility.sql:414-419, predicate at :417) and
  --     then soft-deletes only within that version. The set below is the same
  --     set, and THE TWO MUST STAY IN SYNC: this arm exists solely to answer
  --     "will that soft-delete touch these items?", so any future task that
  --     changes the trigger's set MUST change this one in the same commit.
  --     Widen this and the guard blocks amendments that were never at risk;
  --     narrow it and the guard goes blind to real orphaning.
  --
  --     Why 'final' is excluded rather than blocked on: when no editable
  --     version exists the trigger does not edit the 'final' one in place --
  --     it opens a supplemental version and edits that. Items in a 'final'
  --     version are therefore never soft-deleted and a PR pointing at one
  --     keeps resolving, so blocking there would be a pure false positive
  --     that couples PPMP amendment to HOPE's APP approval queue: an office
  --     could not amend a PPMP for however long the APP sits with HOPE, with
  --     no orphaning risk to justify the wait.
  --
  --     Why 'approved' must be excluded too, and not just 'superseded':
  --     approve_app supersedes only versions whose status is
  --     NOT IN ('approved','superseded') (20240603_app_rpc.sql:531-536), so a
  --     previously-approved version keeps status = 'approved' forever and an
  --     APP routinely has several. Excluding only 'superseded' would leave the
  --     original bug in place for the common case.
  --
  --     app_versions has no deleted_at column, so there is deliberately no
  --     soft-delete filter on av.
  SELECT ai.id,
         ai.item_number,
         ai.general_description,
         'In lot "' || al.lot_name || '" with status ' || al.status
    FROM procurements.app_items ai
    JOIN procurements.app_lots     al ON al.id = ai.lot_id
    JOIN procurements.app_versions av ON av.id = ai.app_version_id
    JOIN procurements.apps         a  ON a.id  = ai.app_id
    JOIN procurements.ppmps        p  ON p.id  = ai.source_ppmp_id
   WHERE ai.source_ppmp_id = p_ppmp_id
     AND ai.deleted_at IS NULL
     AND al.deleted_at IS NULL
     AND a.deleted_at  IS NULL
     AND p.deleted_at  IS NULL
     AND p.division_id = procurements.get_user_division_id()
     AND av.status NOT IN ('final','approved','superseded')
     AND al.status IN ('released','in_procurement')

  UNION ALL

  -- (b) Items referenced by a live PR line. purchase_requests.status CHECK is
  --     ('draft','submitted','budget_certified','approved','in_procurement',
  --      'completed','cancelled') (20260406_procurement_tables.sql:64-68), so
  --     'cancelled' is a real value and excluding it is meaningful. Everything
  --     else, including 'completed', still pins the APP line: a completed PR
  --     is an obligation already incurred against it.
  --
  --     DELIBERATELY NOT VERSION-SCOPED -- DO NOT "FIX" THE ASYMMETRY WITH (a).
  --     A pr_items row holds a foreign key to one specific app_items.id. That
  --     reference is live no matter which APP version that item happens to sit
  --     in, so a superseded or approved version is exactly as damaging here as
  --     the current one: soft-delete the row and the PR still resolves it,
  --     against a line the plan no longer contains. Adding the app_versions
  --     join from arm (a) to this arm would blind the guard to precisely the
  --     case it was written for.
  SELECT ai.id,
         ai.item_number,
         ai.general_description,
         'Referenced by PR ' || pr.pr_number || ' (status ' || pr.status || ')'
    FROM procurements.app_items ai
    JOIN procurements.pr_items pi           ON pi.app_item_id = ai.id
    JOIN procurements.purchase_requests pr  ON pr.id = pi.purchase_request_id
    JOIN procurements.apps a                ON a.id  = ai.app_id
    JOIN procurements.ppmps p               ON p.id  = ai.source_ppmp_id
   WHERE ai.source_ppmp_id = p_ppmp_id
     AND ai.deleted_at IS NULL
     AND pi.deleted_at IS NULL
     AND pr.deleted_at IS NULL
     AND a.deleted_at  IS NULL
     AND p.deleted_at  IS NULL
     AND p.division_id = procurements.get_user_division_id()
     AND pr.status <> 'cancelled';
$$;
