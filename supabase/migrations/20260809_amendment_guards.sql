-- ============================================================
-- 20260809_amendment_guards
--
-- Block a PPMP amendment when the APP items it derived are already in
-- procurement.
--
-- Approving a PPMP amendment fires auto_populate_app_from_ppmp, which
-- soft-deletes every app_item whose source_ppmp_id is the amended PPMP
-- (20260405_ppmp_app_amendment_logic.sql:166-172). A SOFT delete leaves every
-- foreign key resolvable, so purchase_requests.app_item_id, pr_items.app_item_id
-- and app_lots that have already been finalised or released for bidding all
-- keep pointing at an APP line that has vanished from the plan. Nothing
-- downstream raises, and the PR proceeds against a line the APP no longer
-- contains.
--
-- This migration:
--   1. adds procurements.ppmp_has_inflight_procurement(UUID), which lists the
--      APP items an amendment would orphan;
--   2. seeds the ppmp.amend_override permission;
--   3. replaces procurements.create_ppmp_amendment with a 3-argument form that
--      refuses unless p_force is passed by a holder of that permission, and
--      writes an approval_logs entry when it is;
--   4. fixes pre-existing bug P-1 in the same function: its ppmp_lots clone
--      enumerated 13 of the table's 22 columns, silently discarding is_cse and
--      the five schedule columns 20260516 added.
--
-- Idempotent: CREATE OR REPLACE / ON CONFLICT DO NOTHING / DROP ... IF EXISTS.
-- ============================================================

-- ============================================================
-- 1. ppmp_has_inflight_procurement
-- ============================================================
--
-- SECURITY DEFINER is required, not incidental. The tables it reads --
-- app_items, app_lots, pr_items, purchase_requests -- are all under RLS, and
-- the caller is typically the end_user who owns the PPMP, who may well not be
-- able to SELECT the BAC's lots or another office's PRs. Under SECURITY INVOKER
-- those rows would simply be invisible, the count would come back 0, and the
-- guard in create_ppmp_amendment would wave through exactly the amendment it
-- exists to stop. A guard that under-reports is worse than no guard.
--
-- BUT it takes a bare p_ppmp_id and the procurements schema is exposed over
-- PostgREST, so as a definer-rights function with no scoping it would let any
-- authenticated user in division A read item descriptions, lot names and PR
-- numbers out of division B. It is therefore scoped to the caller's own
-- division through procurements.ppmps, which is the same gate
-- create_ppmp_amendment applies before it calls this. An out-of-division (or
-- unauthenticated) caller gets zero rows, never an error, so it leaks nothing
-- -- not even whether the id exists.
--
-- No REVOKE EXECUTE FROM PUBLIC here, unlike the internal helper at
-- 20260807:269. This one is deliberately user-facing: the guard's own error
-- message instructs the user to call it. No extra permission check either -- a
-- caller who can see the PPMP can already see this data through the UI, and
-- requiring ppmp.amend would make the remediation advice unusable by the
-- people who receive it.
--
-- CONSEQUENCE, READ BEFORE USING IT FOR REPORTING: run as a superuser or the
-- service role, auth.uid() is NULL, get_user_division_id() returns NULL, and
-- this returns NO ROWS for every PPMP. A division-wide damage report must
-- query the underlying tables directly rather than through this function.

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
  -- (a) Items sitting in a lot that has moved past composition.
  --
  --     app_lots.status CHECK is ('draft','finalized','in_procurement')
  --     (20240601_app_tables.sql:114-115). The plan originally spelled this
  --     NOT IN ('draft','composed'); there is no 'composed' status, so that
  --     form was accidentally equivalent to <> 'draft' while naming a value
  --     that does not exist -- and would have changed meaning the moment a
  --     real 'composed' status was introduced. Stated positively instead.
  SELECT ai.id,
         ai.item_number,
         ai.general_description,
         'In lot "' || al.lot_name || '" with status ' || al.status
    FROM procurements.app_items ai
    JOIN procurements.app_lots al ON al.id = ai.lot_id
    JOIN procurements.ppmps    p  ON p.id  = ai.source_ppmp_id
   WHERE ai.source_ppmp_id = p_ppmp_id
     AND ai.deleted_at IS NULL
     AND al.deleted_at IS NULL
     AND p.deleted_at  IS NULL
     AND p.division_id = procurements.get_user_division_id()
     AND al.status IN ('finalized','in_procurement')

  UNION ALL

  -- (b) Items referenced by a live PR line. purchase_requests.status CHECK is
  --     ('draft','submitted','budget_certified','approved','in_procurement',
  --      'completed','cancelled') (20260406_procurement_tables.sql:64-68), so
  --     'cancelled' is a real value and excluding it is meaningful. Everything
  --     else, including 'completed', still pins the APP line: a completed PR
  --     is an obligation already incurred against it.
  SELECT ai.id,
         ai.item_number,
         ai.general_description,
         'Referenced by PR ' || pr.pr_number || ' (status ' || pr.status || ')'
    FROM procurements.app_items ai
    JOIN procurements.pr_items pi           ON pi.app_item_id = ai.id
    JOIN procurements.purchase_requests pr  ON pr.id = pi.purchase_request_id
    JOIN procurements.ppmps p               ON p.id  = ai.source_ppmp_id
   WHERE ai.source_ppmp_id = p_ppmp_id
     AND ai.deleted_at IS NULL
     AND pi.deleted_at IS NULL
     AND pr.deleted_at IS NULL
     AND p.deleted_at  IS NULL
     AND p.division_id = procurements.get_user_division_id()
     AND pr.status <> 'cancelled';
$$;

COMMENT ON FUNCTION procurements.ppmp_has_inflight_procurement(UUID) IS
  'Rows returned are APP items derived from this PPMP that an amendment would orphan. Scoped to the calling user''s division.';

-- ============================================================
-- 2. ppmp.amend_override permission
-- ============================================================
-- procurements.permissions has UNIQUE (code) (20240304_permissions_seed.sql:5)
-- so ON CONFLICT (code) is a valid arbiter, and scope's CHECK admits exactly
-- ('platform','division').
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('ppmp.amend_override', 'planning',
   'Amend a PPMP even when derived APP items are already in procurement', 'division')
ON CONFLICT (code) DO NOTHING;

-- procurements.roles keys on `name`, not `code` -- there is no code column
-- (20240303_roles_seed.sql:2-12). procurements.role_permissions has
-- UNIQUE (role_id, permission_id) (20240305_role_permissions_seed.sql:6), the
-- only unique constraint on the table, so a bare ON CONFLICT DO NOTHING is
-- unambiguous.
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('division_admin','bac_chair')
  AND p.code IN ('ppmp.amend_override')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. create_ppmp_amendment -> 3 arguments
-- ============================================================
-- CREATE OR REPLACE cannot add a parameter: a different argument list is a new
-- overload, and an overload whose third argument has a DEFAULT is ambiguous
-- against the 2-argument version for every 2-argument call. Drop the old
-- signature first. Nothing in SQL depends on it -- no trigger, policy or view
-- references it, and its only caller is the PostgREST RPC in
-- src/lib/actions/ppmp.ts, which passes p_ppmp_id and p_justification by name
-- and continues to resolve against the new form through p_force's DEFAULT.
DROP FUNCTION IF EXISTS procurements.create_ppmp_amendment(UUID, TEXT);

-- Body copied verbatim from the live definition at
-- 20260803_stop_stage_writes_from_workflow.sql:223-352 (confirmed to be the
-- last file defining it). Task 4's edits -- indicative_final absent from the
-- ppmp_versions INSERT -- are carried through unchanged. Exactly four edits:
--   1. p_force BOOLEAN DEFAULT false added to the signature.
--   2. v_inflight_count and v_actor added to DECLARE.
--   3. The in-flight procurement guard inserted immediately after the
--      "amendment already in progress" check.
--   4. Bug P-1: the ppmp_lots clone restored from 13 to 19 columns.
-- The ppmp_versions, ppmp_projects and ppmp_lot_items clones are UNCHANGED;
-- they were audited during the Task 8 review and are correct.
-- (ppmp_lot_items.estimated_total_cost is GENERATED ALWAYS ... STORED and is
-- rightly excluded from its clone.)

CREATE OR REPLACE FUNCTION procurements.create_ppmp_amendment(
  p_ppmp_id       UUID,
  p_justification TEXT,
  p_force         BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp            RECORD;
  v_approved_ver    RECORD;
  v_next_version    INTEGER;
  v_new_version_id  UUID;
  v_proj_rec        RECORD;
  v_new_project_id  UUID;
  v_lot_rec         RECORD;
  v_new_lot_id      UUID;
  v_inflight_count  INTEGER;
  v_actor           UUID;
BEGIN
  SELECT *
    INTO v_ppmp
    FROM procurements.ppmps
   WHERE id          = p_ppmp_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  IF v_ppmp.created_by <> auth.uid()
    AND NOT procurements.has_permission('ppmp.amend')
  THEN
    RAISE EXCEPTION 'Insufficient permissions to amend PPMP %', p_ppmp_id;
  END IF;

  IF v_ppmp.status NOT IN ('approved', 'locked') THEN
    RAISE EXCEPTION 'Only approved or locked PPMPs can be amended (current status: %)', v_ppmp.status;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_versions
     WHERE ppmp_id = p_ppmp_id
       AND status  = 'draft'
  ) THEN
    RAISE EXCEPTION 'An amendment is already in progress for PPMP %. Finish or discard it first.', p_ppmp_id;
  END IF;

  -- ----------------------------------------------------------------------
  -- IN-FLIGHT PROCUREMENT GUARD (new in 20260809).
  --
  -- Approving this amendment fires auto_populate_app_from_ppmp, which
  -- soft-deletes every app_item with source_ppmp_id = this PPMP
  -- (20260405_ppmp_app_amendment_logic.sql:166-172). Because that is a SOFT
  -- delete the foreign keys still resolve, so purchase_requests.app_item_id
  -- and pr_items.app_item_id keep pointing at a row the APP no longer shows,
  -- and a lot already released to bidding keeps a line whose ABC the
  -- amendment may have changed. Nothing downstream notices.
  --
  -- Counted once into a variable rather than calling the helper for both the
  -- EXISTS test and the message: the plan's form evaluated the set-returning
  -- function three times per blocked call.
  -- ----------------------------------------------------------------------
  SELECT COUNT(*)
    INTO v_inflight_count
    FROM procurements.ppmp_has_inflight_procurement(p_ppmp_id);

  IF v_inflight_count > 0 THEN
    IF NOT p_force THEN
      -- Adjacent string literals separated by a newline are concatenated by
      -- the lexer into ONE literal before RAISE ever sees them; verified on
      -- PostgreSQL 18. Three % placeholders, three arguments.
      --
      -- The UUID is wrapped in DOUBLED single quotes, NOT written as %L.
      -- RAISE's format string supports only % and %%; it is not format(), so
      -- %L emits the value followed by a stray literal 'L' and no quoting,
      -- producing invalid SQL in the very command this message tells the
      -- user to run. Confirmed by execution before this was written.
      RAISE EXCEPTION
        'Cannot amend PPMP %: % of its APP items are already in procurement. '
        'Review them with: SELECT * FROM procurements.ppmp_has_inflight_procurement(''%''); '
        'then cancel those activities or re-run with p_force := true '
        '(requires the ppmp.amend_override permission).',
        p_ppmp_id, v_inflight_count, p_ppmp_id;
    END IF;

    IF NOT procurements.has_permission('ppmp.amend_override') THEN
      RAISE EXCEPTION
        'Forcing an amendment past in-flight procurement requires the ppmp.amend_override permission.';
    END IF;

    -- approval_logs.acted_by is NOT NULL (20240311_approval_logs.sql:9) and
    -- auth.uid() is NULL without a JWT. The lookup at the top of this
    -- function already makes that unreachable -- ppmps.division_id is NOT
    -- NULL, so `division_id = procurements.get_user_division_id()` can never
    -- be true once get_user_division_id() returns NULL, and the function
    -- exits with 'not found or access denied' long before here. This check
    -- exists so that if that gate is ever loosened, the failure is this
    -- sentence and not a bare not-null violation on an audit table.
    v_actor := auth.uid();
    IF v_actor IS NULL THEN
      RAISE EXCEPTION
        'Cannot force an amendment without an authenticated user (auth.uid() is NULL).';
    END IF;

    -- action = 'noted' is in the approval_logs CHECK set
    -- ('approved','rejected','returned','forwarded','noted').
    -- v_ppmp is the record SELECTed at the top of this function and
    -- procurements.ppmps.office_id is NOT NULL, so v_ppmp.office_id is in
    -- scope and populated here.
    INSERT INTO procurements.approval_logs (
      reference_type, reference_id, step_name, step_order,
      action, acted_by, remarks, office_id
    ) VALUES (
      'ppmp', p_ppmp_id, 'Amendment Override', 6,
      'noted', v_actor,
      'Amendment forced past in-flight procurement ('
        || v_inflight_count || ' item(s) affected). Justification: '
        || COALESCE(p_justification, '(none)'),
      v_ppmp.office_id
    );
  END IF;

  SELECT *
    INTO v_approved_ver
    FROM procurements.ppmp_versions
   WHERE ppmp_id = p_ppmp_id
     AND status  = 'approved'
   ORDER BY version_number DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No approved version found for PPMP % to base amendment on', p_ppmp_id;
  END IF;

  v_next_version := v_ppmp.current_version + 1;

  INSERT INTO procurements.ppmp_versions (
    ppmp_id, version_number, version_type, amendment_justification,
    total_estimated_budget, status, office_id, created_by
  ) VALUES (
    p_ppmp_id, v_next_version, 'amendment', p_justification,
    v_approved_ver.total_estimated_budget, 'draft',
    v_approved_ver.office_id, auth.uid()
  )
  RETURNING id INTO v_new_version_id;

  -- Clone projects → lots → items
  FOR v_proj_rec IN
    SELECT * FROM procurements.ppmp_projects
     WHERE ppmp_version_id = v_approved_ver.id
       AND deleted_at      IS NULL
  LOOP
    INSERT INTO procurements.ppmp_projects (
      ppmp_version_id, ppmp_id, project_number,
      general_description, project_type, office_id, created_by
    ) VALUES (
      v_new_version_id, v_proj_rec.ppmp_id, v_proj_rec.project_number,
      v_proj_rec.general_description, v_proj_rec.project_type,
      v_proj_rec.office_id, auth.uid()
    )
    RETURNING id INTO v_new_project_id;

    FOR v_lot_rec IN
      SELECT * FROM procurements.ppmp_lots
       WHERE ppmp_project_id = v_proj_rec.id
    LOOP
      -- ------------------------------------------------------------------
      -- MANUAL COLUMN ENUMERATION -- BUG P-1, FIXED HERE.
      --
      -- procurements.ppmp_lots has 22 columns: 16 from
      -- 20240505_ppmp_restructure.sql:82-113 plus 6 from
      -- 20260516_app_cse_schedule_columns.sql:25,34.
      -- (20260517_unify_procurement_modes.sql:59 adds a CHECK constraint,
      -- not a column. The table has NO deleted_at, which is why the FOR loop
      -- above correctly has no `deleted_at IS NULL` filter.)
      --
      -- Until now this clone listed 13 of them. 20260516 added its six
      -- columns and did NOT update this list, so every amendment silently
      -- reset is_cse to its NOT NULL DEFAULT false -- reclassifying every
      -- Common-Use Supplies lot as non-CSE -- and blanked schedule_quarter
      -- and all four GPPB schedule dates. It then propagated: the amended
      -- PPMP re-populates the APP through auto_populate_app_from_ppmp, which
      -- reads pl.is_cse and pl.schedule_quarter.
      --
      -- Not cloned, and why: id (identity, generated); created_at/updated_at
      -- (new row's own timestamps, DEFAULT NOW()); ppmp_project_id (rebound
      -- to v_new_project_id, the clone of the parent project).
      -- That is 19 cloned + 3 defaulted + 1 rebound = 22.
      --
      -- The INSERT list and the VALUES list are POSITIONAL. They must stay
      -- the same length and the same order; `INSERT (a,b) VALUES (y,x)` is
      -- valid SQL that writes wrong data forever. Note the two runs of
      -- interchangeable TEXT columns -- procurement_start/procurement_end/
      -- delivery_period/source_of_funds, and schedule_quarter/
      -- advertisement_date/bid_opening_date/award_date/
      -- contract_signing_date -- where a transposition would never be caught
      -- by the type system.
      --
      -- ANY future ALTER TABLE ... ADD COLUMN on procurements.ppmp_lots must
      -- be added to BOTH lists below, in the SAME position.
      -- ------------------------------------------------------------------
      INSERT INTO procurements.ppmp_lots (
        ppmp_project_id, lot_number, lot_title, procurement_mode,
        pre_procurement_conference, procurement_start, procurement_end,
        delivery_period, source_of_funds, estimated_budget,
        supporting_documents, remarks, budget_allocation_id,
        is_cse, schedule_quarter, advertisement_date,
        bid_opening_date, award_date, contract_signing_date
      ) VALUES (
        v_new_project_id, v_lot_rec.lot_number, v_lot_rec.lot_title,
        v_lot_rec.procurement_mode, v_lot_rec.pre_procurement_conference,
        v_lot_rec.procurement_start, v_lot_rec.procurement_end,
        v_lot_rec.delivery_period, v_lot_rec.source_of_funds,
        v_lot_rec.estimated_budget, v_lot_rec.supporting_documents,
        v_lot_rec.remarks, v_lot_rec.budget_allocation_id,
        v_lot_rec.is_cse, v_lot_rec.schedule_quarter,
        v_lot_rec.advertisement_date, v_lot_rec.bid_opening_date,
        v_lot_rec.award_date, v_lot_rec.contract_signing_date
      )
      RETURNING id INTO v_new_lot_id;

      INSERT INTO procurements.ppmp_lot_items (
        ppmp_lot_id, item_number, description, quantity, unit,
        specification, estimated_unit_cost
      )
      SELECT
        v_new_lot_id, item_number, description, quantity, unit,
        specification, estimated_unit_cost
      FROM procurements.ppmp_lot_items
      WHERE ppmp_lot_id = v_lot_rec.id;
    END LOOP;
  END LOOP;

  UPDATE procurements.ppmps
     SET current_version = v_next_version,
         status          = 'draft',
         updated_at      = NOW()
   WHERE id = p_ppmp_id;

  RETURN v_new_version_id;
END;
$$;

