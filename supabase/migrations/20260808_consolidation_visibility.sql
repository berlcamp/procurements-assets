-- ============================================================
-- Consolidation must never fail silently.
--
-- auto_populate_app_from_ppmp() had a bare `RETURN NEW` for the case where no
-- editable APP version exists. HOPE signs the PPMP, the office believes it is
-- in the plan, and it is not. Nothing anywhere records that.
--
-- Design choice: do NOT raise from the trigger. Raising would roll back the
-- HOPE approval itself, which is worse — the approval is valid, it is the
-- consolidation that needs attention. Instead record the failure on the PPMP,
-- log it to approval_logs, and notify the people who can fix it.
--
-- This migration also carries two fixes to the same function body that were
-- found during the Task 8 review (see section 3 below): the supplemental
-- item-clone drops four app_items columns, and neither of the function's two
-- INSERTs writes source_ppmp_version_id.
-- ============================================================

-- ============================================================
-- 1. Schema
-- ============================================================

ALTER TABLE procurements.ppmps
  ADD COLUMN IF NOT EXISTS consolidation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (consolidation_status IN ('pending','consolidated','failed','not_applicable')),
  ADD COLUMN IF NOT EXISTS consolidation_error TEXT,
  ADD COLUMN IF NOT EXISTS consolidated_at TIMESTAMPTZ;

COMMENT ON COLUMN procurements.ppmps.consolidation_status IS
  'Whether this PPMP''s approved items reached the APP. "failed" means an approved plan is missing from the APP.';

COMMENT ON COLUMN procurements.ppmps.consolidation_error IS
  'Human-readable reason the last consolidation attempt did not place this PPMP''s items into an APP version.';

COMMENT ON COLUMN procurements.ppmps.consolidated_at IS
  'When this PPMP''s items last landed in an editable APP version.';

CREATE INDEX IF NOT EXISTS idx_ppmps_consolidation_failed
  ON procurements.ppmps(consolidation_status)
  WHERE consolidation_status = 'failed';

-- ============================================================
-- 2. Backfill — retroactively classify existing PPMPs so pre-existing gaps
--    become visible instead of staying hidden.
--
-- TRIGGER SAFETY. procurements.ppmps carries exactly three triggers:
--   trg_ppmps_updated_at            (20240501_ppmps.sql:167) BEFORE UPDATE,
--                                   sets NEW.updated_at; no cascade.
--   trg_ppmps_audit                 (20240501_ppmps.sql:187) AFTER I/U/D,
--                                   cascades one INSERT into the audit table.
--   trg_auto_populate_app_from_ppmp (20240505_ppmp_restructure.sql:735)
--                                   AFTER UPDATE FOR EACH ROW, NO WHEN clause,
--                                   so it DOES fire on every UPDATE below.
--
-- The third one cascades writes into apps / app_versions / app_items, which
-- carry the immutability guards installed by 20260806 and 20260807. These
-- backfills are nonetheless safe WITHOUT suspending any trigger, because of
-- the function's own status guard (20260516_app_cse_schedule_columns.sql:68):
--
--     IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN RETURN NEW;
--
-- Every UPDATE below writes ONLY consolidation_* columns and never `status`,
-- so OLD.status = NEW.status on every affected row and the guard short-circuits
-- in both directions: non-approved rows fail the first test, approved rows fail
-- the second. No cascade into apps/app_versions/app_items can occur.
--
-- IF A FUTURE EDIT MAKES ANY BACKFILL HERE TOUCH `status`, THIS REASONING
-- COLLAPSES and the migration will abort against the 20260806 guards. Don't.
--
-- Note 20260805_ppmp_content_immutability.sql guards ppmp_projects, ppmp_lots
-- and ppmp_lot_items — NOT ppmps itself — so it is not in play here.
--
-- Every backfill is guarded on `consolidation_status = 'pending'` (the column
-- default), so a re-run is a genuine no-op and neither the trigger's own
-- runtime bookkeeping nor a human's manual remediation can be clobbered.
-- ============================================================

-- Soft-deleted or cancelled PPMPs are never going to reach an APP and must not
-- raise a false alarm on the 'failed' index.
UPDATE procurements.ppmps p
   SET consolidation_status = 'not_applicable'
 WHERE p.consolidation_status = 'pending'
   AND (p.deleted_at IS NOT NULL OR p.status = 'cancelled');

UPDATE procurements.ppmps p
   SET consolidation_status = 'consolidated',
       consolidated_at      = p.approved_at
 WHERE p.consolidation_status = 'pending'
   AND p.deleted_at IS NULL
   AND p.status = 'approved'
   AND EXISTS (
     SELECT 1 FROM procurements.app_items ai
      WHERE ai.source_ppmp_id = p.id AND ai.deleted_at IS NULL
   );

UPDATE procurements.ppmps p
   SET consolidation_status = 'failed',
       consolidation_error  = 'Backfill: approved PPMP has no APP items. Investigate and re-consolidate.'
 WHERE p.consolidation_status = 'pending'
   AND p.deleted_at IS NULL
   AND p.status = 'approved'
   AND NOT EXISTS (
     SELECT 1 FROM procurements.app_items ai
      WHERE ai.source_ppmp_id = p.id AND ai.deleted_at IS NULL
   );

-- ============================================================
-- 3. Record a failure, tell the people who can fix it, and tell the office
--    that was harmed.
--
-- The ppmps UPDATE is unconditional and outside the exception block; the
-- approval_logs and notifications writes are best-effort inside it. See the
-- long comments in the body for why that split is the whole design.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.record_consolidation_failure(
  p_ppmp_id UUID,
  p_reason  TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp   RECORD;
  v_actor  UUID;
BEGIN
  SELECT * INTO v_ppmp FROM procurements.ppmps WHERE id = p_ppmp_id;

  -- Nothing to record against. Return quietly rather than raise: the only
  -- caller is an AFTER UPDATE trigger on this very table, and raising would
  -- roll back a valid approval — the exact outcome this function exists to
  -- avoid.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- notifications.message is TEXT NOT NULL (20240310_notifications.sql:6), and
  -- 'literal ' || NULL evaluates to NULL, so a NULL p_reason would raise a
  -- not-null violation on the notification INSERT — a raise on the failure
  -- path, inside a trigger, which is the one thing this function must never
  -- do. Unreachable today (both call sites pass string literals and EXECUTE is
  -- revoked from PUBLIC) but the guard costs nothing and the raise was live.
  -- p_reason is an IN parameter, which in plpgsql is an ordinary assignable
  -- local variable.
  p_reason := COALESCE(p_reason, 'Unknown consolidation failure.');

  -- THE LOAD-BEARING RECORD. Deliberately OUTSIDE the exception block below.
  -- A plpgsql EXCEPTION handler opens a subtransaction, so everything inside it
  -- is rolled back on a catch; this UPDATE is the very thing this function
  -- exists to write, so it must survive with the approval no matter what the
  -- best-effort side-writes do. DO NOT move it inside the block.
  --
  -- consolidated_at is cleared. On the zero-row branch of
  -- auto_populate_app_from_ppmp() an amendment has just soft-deleted this
  -- PPMP's previous APP items, so a surviving timestamp would assert a success
  -- that has since been undone. After this, consolidation_status = 'failed'
  -- always implies consolidated_at IS NULL. Nothing else in supabase/ or src/
  -- reads consolidated_at, so nothing depends on it surviving a failure.
  --
  -- Writes ONLY consolidation_* columns. See the trigger-safety note above:
  -- this re-fires trg_auto_populate_app_from_ppmp on the same row, and the
  -- status guard short-circuits it because OLD.status = NEW.status. Touching
  -- `status` here would make it recurse into a real consolidation attempt.
  UPDATE procurements.ppmps
     SET consolidation_status = 'failed',
         consolidation_error  = p_reason,
         consolidated_at      = NULL,
         updated_at           = NOW()
   WHERE id = p_ppmp_id;

  -- ------------------------------------------------------------------
  -- BEST-EFFORT SIDE-WRITES. Nothing below may escape as an exception.
  --
  -- WHY THIS IS STRUCTURAL AND NOT ANALYTICAL. This function is called from
  -- auto_populate_app_from_ppmp(), an AFTER UPDATE trigger on
  -- procurements.ppmps that fires inside the HOPE approval's own transaction.
  -- ANY exception that escapes rolls back the approval itself — a valid
  -- approval destroyed by the bookkeeping meant to report a problem. This body
  -- has twice shipped a raise that statement-by-statement review did not catch,
  -- because both were invisible until runtime and only DDL cross-checking could
  -- see them: a join on up.user_id against a table with no such column, and a
  -- nullable COALESCE chain into approval_logs.acted_by NOT NULL. Neither
  -- failed at CREATE time; both would have surfaced in production, on the error
  -- path. The guarantee must not depend on the next editor repeating that
  -- cross-check correctly.
  --
  -- THE TRADE-OFF, STATED PLAINLY. A plpgsql EXCEPTION block opens a
  -- subtransaction, so on a catch BOTH side-writes are rolled back — including
  -- a notification INSERT that had already partly succeeded — and only the
  -- RAISE WARNING breadcrumb in the server log survives. What does survive is
  -- the HOPE approval and the 'failed' mark written above. That is exactly the
  -- stated preference: degraded reporting beats a rolled-back approval.
  -- ------------------------------------------------------------------
  BEGIN
    -- approval_logs.acted_by is NOT NULL (20240311_approval_logs.sql:9), and
    -- both ppmps.approved_by and ppmps.created_by are nullable. Falling
    -- through to a NULL here would raise a not-null violation. Skip the log
    -- entry instead — the PPMP row itself already carries the failure, which is
    -- the load-bearing record.
    v_actor := COALESCE(v_ppmp.approved_by, v_ppmp.created_by, auth.uid());

    IF v_actor IS NOT NULL THEN
      INSERT INTO procurements.approval_logs (
        reference_type, reference_id, step_name, step_order,
        action, acted_by, remarks, office_id
      ) VALUES (
        'ppmp', p_ppmp_id, 'APP Consolidation', 5,
        'noted', v_actor,
        'Consolidation failed: ' || p_reason, v_ppmp.office_id
      );
    END IF;

    -- TWO audiences, ONE query, at most ONE notification per person.
    --
    --   (1) THE PEOPLE WHO CAN FIX IT — every active holder of
    --       app.bac_manage_lots in the division: bac_chair, bac_member,
    --       bac_secretariat and division_admin
    --       (20240602_app_rls.sql:50-91), plus bac_vice_chair, which copies
    --       bac_chair's grants (20260520_bac_vice_chair_role.sql:12-15).
    --       Recovery requires an APP amendment, which is theirs to create.
    --   (2) THE OFFICE THAT WAS HARMED — every active member of the
    --       originating office. This migration's opening premise is that the
    --       office believes its plan is in the APP when it is not; notifying
    --       only the BAC leaves that belief intact. `hope`, who signed it,
    --       does not hold app.bac_manage_lots either. ppmps.office_id is
    --       NOT NULL (20240501_ppmps.sql:13).
    --
    -- DEDUPE IS STRUCTURAL. A bac_member sitting in the originating office is
    -- in both audiences and must receive exactly one notification. This is ONE
    -- scan of user_profiles with the two audiences as an OR, so up.id — the
    -- table's PRIMARY KEY (20240302_user_profiles.sql:3) — can appear at most
    -- once. The permission chain is an EXISTS subquery rather than a join, so a
    -- user holding app.bac_manage_lots through several roles still yields one
    -- row (the DISTINCT is now belt-and-braces). A UNION of two SELECTs would
    -- also dedupe, but ONLY while both branches emit byte-identical rows —
    -- tailor one message and it silently becomes two notifications. DO NOT
    -- restructure this into a UNION.
    --
    -- NOTE: procurements.user_profiles has NO user_id column — its primary key
    -- IS the auth.users id (20240302_user_profiles.sql:3). Joining on
    -- up.user_id creates cleanly (plpgsql does not resolve column names at
    -- CREATE time) and then fails at runtime. Join on up.id.
    --
    -- type = 'warning' is in the notifications CHECK set
    -- (20240310_notifications.sql:8); office_id is v_ppmp.office_id, a live
    -- procurements.offices FK (20240310_notifications.sql:13).
    INSERT INTO procurements.notifications (
      user_id, title, message, type, reference_type, reference_id, office_id
    )
    SELECT DISTINCT up.id,
           'PPMP not consolidated into APP',
           'An approved PPMP did NOT reach the APP, so its items are missing '
           || 'from the plan: ' || p_reason
           || ' The BAC has been notified; recovering it requires an APP amendment.',
           'warning',
           'ppmp',
           p_ppmp_id,
           v_ppmp.office_id
      FROM procurements.user_profiles up
     WHERE up.division_id = v_ppmp.division_id
       AND up.deleted_at  IS NULL
       AND up.is_active
       AND (
         -- (2) the office that was harmed
         up.office_id = v_ppmp.office_id
         -- (1) the people who can fix it
         OR EXISTS (
           SELECT 1
             FROM procurements.user_roles ur
             JOIN procurements.role_permissions rp ON rp.role_id = ur.role_id
             JOIN procurements.permissions perm    ON perm.id = rp.permission_id
            WHERE ur.user_id     = up.id
              AND ur.division_id = v_ppmp.division_id
              AND ur.is_active
              AND ur.revoked_at  IS NULL
              AND perm.code      = 'app.bac_manage_lots'
         )
       );
  EXCEPTION WHEN OTHERS THEN
    -- Swallow deliberately. Propagating rolls back the HOPE approval.
    RAISE WARNING 'record_consolidation_failure: side-writes failed for PPMP %: %',
      p_ppmp_id, SQLERRM;
  END;
END;
$$;

COMMENT ON FUNCTION procurements.record_consolidation_failure(UUID, TEXT) IS
  'Marks a PPMP as failed-to-consolidate (clearing consolidated_at), logs it, and notifies both app.bac_manage_lots holders (who can fix it) and the originating office (who was harmed), one notification each. The ppmps UPDATE is unconditional; the log and notification writes are best-effort inside an exception block, because this runs in an AFTER UPDATE trigger and any escaping exception would roll back the HOPE approval. INTERNAL: called only by auto_populate_app_from_ppmp(); EXECUTE is revoked from PUBLIC.';

-- INTERNAL HELPER, not an API. Postgres grants EXECUTE TO PUBLIC on every new
-- function by default and the procurements schema is exposed over PostgREST,
-- so without this REVOKE any authenticated user could call it to mark an
-- arbitrary PPMP in any division as failed, write an approval_logs entry
-- attributed to that PPMP's approver, and fan out notifications. It is
-- SECURITY DEFINER and carries no division or permission check of its own.
-- Same reasoning and same precedent as remap_app_amendment_lots
-- (20260807_app_item_provenance.sql:269).
--
-- The only caller, auto_populate_app_from_ppmp(), is itself SECURITY DEFINER
-- and executes as the function owner, so it retains EXECUTE regardless of what
-- PUBLIC holds. Any future caller reached directly from the client MUST be
-- granted explicitly and MUST do its own authorisation first.
REVOKE EXECUTE ON FUNCTION procurements.record_consolidation_failure(UUID, TEXT) FROM PUBLIC;

-- ============================================================
-- 4. auto_populate_app_from_ppmp: copied VERBATIM from the live definition in
--    20260516_app_cse_schedule_columns.sql:53-258, with exactly five edits.
--
--    (1) The silent bail-out at 20260516:203-206 now calls
--        record_consolidation_failure() before returning.
--    (2) A success marker is written before the final RETURN NEW. If the
--        populate INSERT produced zero rows the PPMP is recorded as failed
--        instead — an approved PPMP that contributes no APP line is exactly
--        the invisible non-consolidation this task exists to surface, and it
--        keeps the runtime classification consistent with section 2's backfill
--        (which calls "approved with no live app_items" a failure).
--    (3) P-2 clone drift: the supplemental carry-forward clone at
--        20260516:148-178 dropped indicative_budget, budget_adjusted_by,
--        budget_adjusted_at and source_ppmp_lot_item_ids. All four restored.
--    (4) I4 provenance: source_ppmp_version_id (added by 20260807) is now
--        written by BOTH INSERTs.
--    (5) Version scoping: the fresh-populate INSERT joined ppmp_versions on
--        status = 'approved' alone, which matches EVERY previously approved
--        version, so each amendment approval consolidated the same cloned
--        projects twice at full budget. Now scoped to
--        version_number = NEW.current_version. See the long comment at the
--        WHERE clause for the two-part root cause.
--    (6) Carry-forward source version: the supplemental clone looked up its
--        source with `status = 'approved'`, which both missed the 'final'
--        window entirely (empty supplemental) and, once any version had been
--        approved, preferred that older 'approved' row over a newer 'final' one
--        (stale clone / silent data loss). Now IN ('final','approved') — the
--        exact complement of the editable-version lookup minus 'superseded'.
--        See the long comment at that SELECT.
--
--    Everything else — including the status guard, the APP auto-create, the
--    supplemental-version creation, the lot clone, the APP status reset, the
--    amendment soft-delete, and the CSE/schedule column propagation this file
--    introduced — is unchanged.
--
--    DO NOT rebuild this body from 20260405_ppmp_app_amendment_logic.sql,
--    20240604_app_triggers.sql or 20240505_ppmp_restructure.sql. All three are
--    superseded and copying any of them silently reverts the CSE and schedule
--    column propagation.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.auto_populate_app_from_ppmp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app_id           UUID;
  v_app_version_id   UUID;
  v_app_status       TEXT;
  v_is_amendment      BOOLEAN;
  v_source_ver_id    UUID;
  v_next_ver_num     INTEGER;
  v_inserted_count   INTEGER;
BEGIN
  -- Only fire when PPMP transitions to 'approved'
  --
  -- LOAD-BEARING BEYOND ITS APPEARANCE: this guard is also what makes it safe
  -- for this function, and for any migration, to UPDATE consolidation_* columns
  -- on procurements.ppmps. Those writes re-enter this trigger with
  -- OLD.status = NEW.status, and this line is the only thing that stops them
  -- from cascading into apps/app_versions/app_items or recursing. Preserve it
  -- verbatim.
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Safety: skip if app_items table doesn't exist yet.
  -- This is a schema-bootstrap guard from the original migration ordering, not
  -- an operational path — app_items has existed since 20240601_app_tables.sql,
  -- so this branch is unreachable on any live database. Deliberately left
  -- silent: recording a consolidation failure here would report a condition
  -- that cannot occur.
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'procurements'
       AND table_name   = 'app_items'
  ) THEN
    RETURN NEW;
  END IF;

  -- Check if this is an amendment (version > 1 means re-approval)
  v_is_amendment := (NEW.current_version > 1);

  -- Locate or create the APP for this division + fiscal year
  SELECT id, status INTO v_app_id, v_app_status
    FROM procurements.apps
   WHERE division_id    = NEW.division_id
     AND fiscal_year_id = NEW.fiscal_year_id
     AND deleted_at     IS NULL
   LIMIT 1;

  IF v_app_id IS NULL THEN
    -- Auto-create APP (first PPMP approval for this division + FY)
    INSERT INTO procurements.apps (
      division_id, fiscal_year_id, status, indicative_final, created_by
    ) VALUES (
      NEW.division_id, NEW.fiscal_year_id, 'populating', 'indicative', NEW.approved_by
    )
    RETURNING id INTO v_app_id;

    INSERT INTO procurements.app_versions (
      app_id, version_number, version_type, status, indicative_final, created_by
    ) VALUES (
      v_app_id, 1, 'original', 'draft', 'indicative', NEW.approved_by
    );

    v_app_status := 'populating';
  END IF;

  -- Find a working (editable) APP version
  SELECT id INTO v_app_version_id
    FROM procurements.app_versions
   WHERE app_id = v_app_id
     AND status NOT IN ('final', 'approved', 'superseded')
   ORDER BY version_number DESC
   LIMIT 1;

  -- If no editable version exists AND this is an amendment,
  -- auto-create a supplemental APP version
  IF v_app_version_id IS NULL AND v_is_amendment THEN
    SELECT COALESCE(MAX(version_number), 0) + 1
      INTO v_next_ver_num
      FROM procurements.app_versions
     WHERE app_id = v_app_id;

    INSERT INTO procurements.app_versions (
      app_id, version_number, version_type,
      amendment_justification,
      status, indicative_final, created_by
    ) VALUES (
      v_app_id, v_next_ver_num, 'supplemental',
      'Auto-created from PPMP amendment (PPMP v' || NEW.current_version || ')',
      'draft', 'indicative', NEW.approved_by
    )
    RETURNING id INTO v_app_version_id;

    -- Carry the rest of the plan forward: find the version that IS the current
    -- locked plan and clone its items into the new supplemental version.
    --
    -- THIS STATUS SET MUST STAY IN SYNC WITH THE EDITABLE-VERSION LOOKUP ABOVE.
    -- app_versions.status is one of ('draft','under_review','bac_finalization',
    -- 'final','approved','superseded') (20240601_app_tables.sql:45-46). The
    -- editable lookup takes NOT IN ('final','approved','superseded'); the
    -- versions that represent the current locked plan are its EXACT COMPLEMENT
    -- MINUS 'superseded', i.e. IN ('final','approved'). Change one predicate and
    -- you must change the other.
    --
    -- THIS READ `status = 'approved'` AND WAS WRONG IN TWO SEPARATE WAYS.
    --
    --   (1) EMPTY SUPPLEMENTAL. In a division's first APP year version 1 goes
    --       draft -> ... -> final -> approved. Throughout the 'final' window
    --       there is no 'approved' version at all, so this returned NULL and the
    --       clone below was skipped ENTIRELY. The supplemental then held ONLY
    --       the amending PPMP's items — every other office's lines absent from
    --       the new current version — while the UPDATE below simultaneously
    --       knocked apps.status from 'final' back to 'indicative'.
    --
    --   (2) STALE SOURCE — worse, because it is silent data loss rather than
    --       visible emptiness. approve_app supersedes only versions
    --       NOT IN ('approved','superseded') (20240603_app_rpc.sql:531-536), so
    --       a PREVIOUSLY approved version keeps status = 'approved' FOREVER.
    --       With v1 'approved' and v2 'final', ORDER BY version_number DESC over
    --       status = 'approved' picks v1 — the supplemental cloned the OLDER
    --       version and silently dropped everything added in v2. Same family as
    --       the ppmp_versions scoping fix at the bottom of this function: status
    --       ALONE DOES NOT IDENTIFY ONE VERSION on either side of this trigger.
    --
    -- Neither case orphans anything — pr_items still resolve to the old rows —
    -- which is why the 20260809 APP-amendment guard does not and cannot catch
    -- it. Its predicate is deliberately aligned with the EDITABLE lookup above,
    -- which this fix does not touch.
    SELECT id INTO v_source_ver_id
      FROM procurements.app_versions
     WHERE app_id = v_app_id
       AND status IN ('final', 'approved')
     ORDER BY version_number DESC
     LIMIT 1;

    -- UNREACHABLE AFTER THE FIX ABOVE. KEPT AS DEFENCE IN DEPTH, NOT DROPPED.
    -- To be here at all, no version of this APP is editable, so every version is
    -- in ('final','approved','superseded'). The set is never empty: every
    -- APP-creation path inserts version 1 as 'draft' (this function, above, and
    -- create_app 20240603_app_rpc.sql:649-653). And "all superseded" cannot
    -- occur: the ONLY writer of 'superseded' is approve_app:532-536, which in
    -- the same breath sets exactly one version to 'approved' and excludes it
    -- from the supersede set (id <> v_version_id), and nothing anywhere moves a
    -- version back off 'approved'. So IN ('final','approved') always matches at
    -- least one row and this branch always runs.
    --
    -- record_consolidation_failure() is deliberately NOT used on the ELSE. It
    -- marks NEW.id as failed, but NEW.id is the one PPMP that DOES land
    -- correctly on this path — the missing items belong to the OTHER offices —
    -- and the success marker at the end of this function would overwrite the
    -- mark a few statements later anyway. RAISE WARNING is the honest
    -- breadcrumb here and, unlike RAISE EXCEPTION, can never roll back the HOPE
    -- approval this migration exists to protect.
    IF v_source_ver_id IS NOT NULL THEN
      -- Clone items (excluding old items from this same PPMP)
      --
      -- MANUAL ENUMERATION, NOT SELECT *. This list must name every column of
      -- procurements.app_items that should carry forward. Two migrations have
      -- already added columns WITHOUT updating it, and the omissions were
      -- silent and permanent:
      --   20260519_indicative_final_budget_tracking.sql:11 added
      --     indicative_budget, budget_adjusted_by, budget_adjusted_at
      --   20260729_app_item_line_level_lotting.sql:23 added
      --     source_ppmp_lot_item_ids
      -- Dropping source_ppmp_lot_item_ids is worse than data loss: NULL MEANS
      -- "covers every line of the source PPMP lot", so where a lot had been
      -- split across two APP items both clones came out NULL and both then
      -- claimed the full line set at half the budget each.
      -- (20260807_app_item_provenance.sql:11 added source_ppmp_version_id and
      -- is fixed here at the same time.)
      --
      -- ANY future column added to procurements.app_items MUST also be added
      -- here, in BOTH the INSERT column list and the SELECT list, IN THE SAME
      -- POSITION. A positional swap between the two lists is valid SQL, runs
      -- clean, and writes wrong data forever — take particular care with the
      -- four consecutive UUIDs (source_ppmp_project_id, source_ppmp_lot_id,
      -- source_ppmp_id, source_ppmp_version_id) and the five consecutive TEXT
      -- date fields (schedule_quarter, advertisement_date, bid_opening_date,
      -- award_date, contract_signing_date).
      INSERT INTO procurements.app_items (
        app_version_id,                   --  1
        app_id,                           --  2
        source_ppmp_project_id,           --  3
        source_ppmp_lot_id,               --  4
        source_ppmp_id,                   --  5
        source_ppmp_version_id,           --  6
        item_number,                      --  7
        general_description,              --  8
        project_type,                     --  9
        procurement_mode,                 -- 10
        estimated_budget,                 -- 11
        source_of_funds,                  -- 12
        procurement_start,                -- 13
        procurement_end,                  -- 14
        delivery_period,                  -- 15
        budget_allocation_id,             -- 16
        source_office_id,                 -- 17
        hope_review_status,               -- 18
        hope_reviewed_by,                 -- 19
        hope_reviewed_at,                 -- 20
        hope_remarks,                     -- 21
        lot_id,                           -- 22
        lot_item_number,                  -- 23
        remarks,                          -- 24
        created_by,                       -- 25
        source_ppmp_project_description,  -- 26
        is_cse,                           -- 27
        schedule_quarter,                 -- 28
        advertisement_date,               -- 29
        bid_opening_date,                 -- 30
        award_date,                       -- 31
        contract_signing_date,            -- 32
        source_ppmp_lot_item_ids,         -- 33
        indicative_budget,                -- 34
        budget_adjusted_by,               -- 35
        budget_adjusted_at                -- 36
      )
      SELECT
        v_app_version_id,                 --  1 app_version_id (the new one)
        app_id,                           --  2 app_id
        source_ppmp_project_id,           --  3 source_ppmp_project_id
        source_ppmp_lot_id,               --  4 source_ppmp_lot_id
        source_ppmp_id,                   --  5 source_ppmp_id
        source_ppmp_version_id,           --  6 source_ppmp_version_id
        item_number,                      --  7 item_number
        general_description,              --  8 general_description
        project_type,                     --  9 project_type
        procurement_mode,                 -- 10 procurement_mode
        estimated_budget,                 -- 11 estimated_budget
        source_of_funds,                  -- 12 source_of_funds
        procurement_start,                -- 13 procurement_start
        procurement_end,                  -- 14 procurement_end
        delivery_period,                  -- 15 delivery_period
        budget_allocation_id,             -- 16 budget_allocation_id
        source_office_id,                 -- 17 source_office_id
        hope_review_status,               -- 18 hope_review_status
        hope_reviewed_by,                 -- 19 hope_reviewed_by
        hope_reviewed_at,                 -- 20 hope_reviewed_at
        hope_remarks,                     -- 21 hope_remarks
        NULL::UUID,                       -- 22 lot_id       — BAC re-lots later
        NULL::INTEGER,                    -- 23 lot_item_number — BAC re-lots later
        remarks,                          -- 24 remarks
        created_by,                       -- 25 created_by
        source_ppmp_project_description,  -- 26 source_ppmp_project_description
        is_cse,                           -- 27 is_cse
        schedule_quarter,                 -- 28 schedule_quarter
        advertisement_date,               -- 29 advertisement_date
        bid_opening_date,                 -- 30 bid_opening_date
        award_date,                       -- 31 award_date
        contract_signing_date,            -- 32 contract_signing_date
        source_ppmp_lot_item_ids,         -- 33 source_ppmp_lot_item_ids
        indicative_budget,                -- 34 indicative_budget
        budget_adjusted_by,               -- 35 budget_adjusted_by
        budget_adjusted_at                -- 36 budget_adjusted_at
      FROM procurements.app_items
      WHERE app_version_id = v_source_ver_id
        AND deleted_at IS NULL
        AND source_ppmp_id <> NEW.id;

      -- Clone lots (without item assignments)
      INSERT INTO procurements.app_lots (
        app_id, app_version_id, lot_number, lot_name, description,
        procurement_method, total_estimated_cost, status,
        division_id, created_by
      )
      SELECT
        app_id, v_app_version_id, lot_number, lot_name, description,
        procurement_method, 0, 'draft',
        division_id, created_by
      FROM procurements.app_lots
      WHERE app_version_id = v_source_ver_id
        AND deleted_at IS NULL;
    ELSE
      RAISE WARNING 'auto_populate_app_from_ppmp: APP % has no final/approved version to carry forward; supplemental version % was created holding only PPMP %',
        v_app_id, v_app_version_id, NEW.id;
    END IF;

    -- Reset APP status
    UPDATE procurements.apps
       SET status     = 'indicative',
           updated_at = NOW()
     WHERE id = v_app_id
       AND status IN ('approved', 'final', 'posted');
  END IF;

  -- Still no editable version — this PPMP is approved but cannot reach the APP.
  -- Record it instead of returning silently.
  IF v_app_version_id IS NULL THEN
    PERFORM procurements.record_consolidation_failure(
      NEW.id,
      'No editable APP version exists for this division and fiscal year. '
      || 'The APP is likely already final or approved — create an APP amendment, then re-approve this PPMP.'
    );
    RETURN NEW;
  END IF;

  -- For amendments: soft-delete old APP items from this same PPMP
  IF v_is_amendment THEN
    UPDATE procurements.app_items
       SET deleted_at = NOW()
     WHERE app_version_id = v_app_version_id
       AND source_ppmp_id = NEW.id
       AND deleted_at IS NULL;
  END IF;

  -- Insert the newly approved PPMP projects/lots as APP items
  --
  -- MANUAL ENUMERATION, NOT SELECT *. Same warning as the clone above: two
  -- migrations (20260519 and 20260729) have already added columns to
  -- procurements.app_items without updating a list like this one, and
  -- 20260807 added source_ppmp_version_id, which this INSERT never set until
  -- now. ANY future column added to app_items MUST also be added here, in BOTH
  -- the INSERT column list and the SELECT list, IN THE SAME POSITION — a
  -- same-typed positional swap is silent, valid, and permanent.
  --
  -- Columns deliberately omitted (all correct as their defaults):
  --   id, created_at, updated_at, deleted_at  — DB defaults / new identity
  --   hope_reviewed_by/_at, hope_remarks      — brand new item, not yet reviewed
  --   lot_id, lot_item_number                 — the BAC assigns lots later
  --   indicative_budget, budget_adjusted_by,
  --     budget_adjusted_at                    — snapshotted by finalize_app()
  --   source_ppmp_lot_item_ids                — NULL means "every line of the
  --                                             source PPMP lot", which is
  --                                             exactly true for a fresh
  --                                             whole-lot consolidation
  INSERT INTO procurements.app_items (
    app_version_id,                   --  1
    app_id,                           --  2
    source_ppmp_project_id,           --  3
    source_ppmp_lot_id,               --  4
    source_ppmp_id,                   --  5
    source_ppmp_version_id,           --  6
    item_number,                      --  7
    general_description,              --  8
    project_type,                     --  9
    procurement_mode,                 -- 10
    estimated_budget,                 -- 11
    source_of_funds,                  -- 12
    procurement_start,                -- 13
    procurement_end,                  -- 14
    delivery_period,                  -- 15
    budget_allocation_id,             -- 16
    source_office_id,                 -- 17
    remarks,                          -- 18
    hope_review_status,               -- 19
    created_by,                       -- 20
    source_ppmp_project_description,  -- 21
    is_cse,                           -- 22
    schedule_quarter,                 -- 23
    advertisement_date,               -- 24
    bid_opening_date,                 -- 25
    award_date,                       -- 26
    contract_signing_date             -- 27
  )
  SELECT
    v_app_version_id,                 --  1 app_version_id
    v_app_id,                         --  2 app_id
    pp.id,                            --  3 source_ppmp_project_id
    pl.id,                            --  4 source_ppmp_lot_id
    pp.ppmp_id,                       --  5 source_ppmp_id
    pp.ppmp_version_id,               --  6 source_ppmp_version_id
    ROW_NUMBER() OVER (ORDER BY pp.project_number, pl.lot_number)
      + COALESCE((
          SELECT MAX(item_number) FROM procurements.app_items
           WHERE app_version_id = v_app_version_id AND deleted_at IS NULL
        ), 0),                        --  7 item_number
    pp.general_description,           --  8 general_description
    pp.project_type,                  --  9 project_type
    pl.procurement_mode,              -- 10 procurement_mode
    pl.estimated_budget,              -- 11 estimated_budget
    pl.source_of_funds,               -- 12 source_of_funds
    pl.procurement_start,             -- 13 procurement_start
    pl.procurement_end,               -- 14 procurement_end
    pl.delivery_period,               -- 15 delivery_period
    pl.budget_allocation_id,          -- 16 budget_allocation_id
    pp.office_id,                     -- 17 source_office_id
    pl.remarks,                       -- 18 remarks
    'pending',                        -- 19 hope_review_status
    pp.created_by,                    -- 20 created_by
    pp.general_description,           -- 21 source_ppmp_project_description
    pl.is_cse,                        -- 22 is_cse
    pl.schedule_quarter,              -- 23 schedule_quarter
    pl.advertisement_date,            -- 24 advertisement_date
    pl.bid_opening_date,              -- 25 bid_opening_date
    pl.award_date,                    -- 26 award_date
    pl.contract_signing_date          -- 27 contract_signing_date
  FROM procurements.ppmp_projects pp
  JOIN procurements.ppmp_versions pv ON pv.id = pp.ppmp_version_id
  JOIN procurements.ppmp_lots pl ON pl.ppmp_project_id = pp.id
  -- VERSION SCOPING. LOAD-BEARING. DO NOT "SIMPLIFY" THIS PREDICATE AWAY.
  --
  -- ROOT CAUSE, PART 1 — approve_ppmp leaves prior approvals 'approved'.
  -- It supersedes only versions whose status is NOT IN ('approved','superseded')
  -- (20260803_stop_stage_writes_from_workflow.sql:58-63), so a PREVIOUSLY
  -- approved version keeps status = 'approved' forever. After one amendment a
  -- PPMP has TWO rows in ppmp_versions with status = 'approved'.
  --
  -- ROOT CAUSE, PART 2 — this join used to trust that status alone identified
  -- one version. It does not. Because create_ppmp_amendment clones v1's
  -- projects and lots forward into v2 (20260803:296-341), the two approved
  -- versions hold the SAME content, so every project was consolidated TWICE, at
  -- FULL budget, on every amendment approval. The amendment soft-delete above
  -- does not mask it: that clears only the OLD items, and this INSERT then
  -- re-added both versions. 20260807 made the symptom harder to recognise, not
  -- less real — each duplicate now carries a different source_ppmp_version_id,
  -- so the duplication reads as two legitimate distinct sources.
  --
  -- WHY NEW.current_version IS THE RIGHT ANCHOR. approve_ppmp picks the version
  -- to approve by version_number = ppmps.current_version (20260803:46-49), and
  -- its ppmps UPDATE (20260803:65-71) does not touch current_version, so at
  -- trigger time it still names the version just approved. approve_ppmp is the
  -- only code path in supabase/ or src/ that sets ppmps.status = 'approved'
  -- (return_ppmp only yields revision_required/submitted/chief_reviewed; the
  -- client only ever writes 'cancelled'). ppmp_versions carries
  -- UNIQUE (ppmp_id, version_number) (20240501_ppmps.sql:67), so this pair
  -- identifies AT MOST ONE version.
  --
  -- pv.status = 'approved' IS RETAINED DELIBERATELY — belt-and-braces, NOT
  -- redundancy. It asserts that the version being consolidated really is the
  -- approved one. If a future edit ever lets ppmps.status reach 'approved'
  -- without the matching ppmp_version being approved, this line converts a
  -- silent wrong consolidation into the recorded zero-row failure below, which
  -- is the outcome this migration exists to produce. KEEP BOTH PREDICATES.
  --
  -- NOT FIXED HERE, ON PURPOSE: making approve_ppmp supersede prior approved
  -- versions would change what status = 'approved' means for every read path
  -- (version history, badges, create_ppmp_amendment's clone-source lookup, and
  -- 20260807's already-applied provenance backfill all key off it). That is a
  -- separate, much wider decision. Existing APPs already carrying duplicates
  -- from this bug are a separate remediation task.
  WHERE pv.ppmp_id        = NEW.id
    AND pv.version_number = NEW.current_version
    AND pv.status         = 'approved'
    AND pp.deleted_at     IS NULL;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  IF v_inserted_count = 0 THEN
    -- An editable APP version existed and we still contributed nothing. For an
    -- amendment the old items were just soft-deleted above, so this PPMP is now
    -- genuinely absent from the APP. Same visible outcome as any other failure.
    PERFORM procurements.record_consolidation_failure(
      NEW.id,
      'The approved PPMP version contains no projects or lots, so no APP items were created. '
      || 'Check that the approved version has at least one project with one lot.'
    );
    RETURN NEW;
  END IF;

  -- Success marker. Writes ONLY consolidation_* columns, so the re-entry into
  -- this trigger short-circuits on the status guard above.
  UPDATE procurements.ppmps
     SET consolidation_status = 'consolidated',
         consolidation_error  = NULL,
         consolidated_at      = NOW()
   WHERE id = NEW.id;

  RETURN NEW;
END;
$$;
