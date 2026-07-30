-- ============================================================
-- Assertions for 20260809_amendment_guards.
--
-- Run BEFORE the migration: fails at section 1 with
--   ASSERTION FAILED: procurements.ppmp_has_inflight_procurement(UUID) missing
-- Run AFTER: prints PASS: 20260809_amendment_guards.
--
-- HOW TO ADD TO THIS FILE, READ FIRST:
--
-- (a) Match against v_src, NEVER v_def. pg_get_functiondef() returns the
--     source INCLUDING comments, and both functions here carry long comments
--     that NAME every token asserted below -- they exist precisely to explain
--     why those tokens must not be removed. Against the raw definition every
--     check would pass on comment text alone, so the likeliest regression
--     (someone deletes the code but leaves the comment warning about it)
--     would sail through. v_src strips SQL line comments first.
--
-- (b) Anchor to the CONSTRUCT, not to a loose substring. The precedent is
--     20260808's '%consolidated_at%NULL%', which was vacuous because an
--     unrelated `deleted_at IS NULL` elsewhere in the same body satisfied it.
--     Every body check below is a regex pinned to an operator or a keyword.
--
-- (c) Filter pg_proc by pronargs. plpgsql SELECT ... INTO silently keeps an
--     ARBITRARY row when several match, so an overload added later would make
--     every downstream check test a random definition.
-- ============================================================

DO $$
DECLARE
  v_def       TEXT;
  v_src       TEXT;
  v_secdef    BOOLEAN;
  v_ndefaults INTEGER;
  v_n         INTEGER;
  v_ins       TEXT[];
  v_cols      TEXT[];
  v_vals      TEXT[];
  v_missing   TEXT := '';
  v_expected  TEXT[] := ARRAY[
    'is_cse','schedule_quarter','advertisement_date',
    'bid_opening_date','award_date','contract_signing_date'
  ];
  v_col       TEXT;
  i           INTEGER;
BEGIN
  -- ----------------------------------------------------------------
  -- 1. ppmp_has_inflight_procurement(UUID)
  --
  --    Deliberately the first assertion: it is the one that fails on an
  --    unmigrated database, so a run before `supabase db push` stops here
  --    with an unambiguous message rather than somewhere confusing.
  -- ----------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname  = 'procurements'
       AND p.proname  = 'ppmp_has_inflight_procurement'
       AND p.pronargs = 1
  ) THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: procurements.ppmp_has_inflight_procurement(UUID) missing';
  END IF;

  -- SECURITY DEFINER is load-bearing. app_items, app_lots, pr_items and
  -- purchase_requests are all under RLS, and the typical caller is the
  -- end_user who owns the PPMP -- who often cannot SELECT the BAC's lots or
  -- another office's PRs. Under SECURITY INVOKER those rows go invisible, the
  -- count returns 0, and create_ppmp_amendment waves through exactly the
  -- amendment this migration exists to stop. A guard that under-reports is
  -- worse than no guard, and it fails OPEN and SILENTLY.
  SELECT p.prosecdef INTO v_secdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname  = 'procurements'
     AND p.proname  = 'ppmp_has_inflight_procurement'
     AND p.pronargs = 1;

  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp_has_inflight_procurement is not SECURITY DEFINER -- under RLS it will silently return 0 rows for callers who cannot see BAC lots or other offices'' PRs, and the amendment guard will fail open';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname  = 'procurements'
     AND p.proname  = 'ppmp_has_inflight_procurement'
     AND p.pronargs = 1;

  v_src := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');

  -- 1a. Division scoping. This is the ONLY thing standing between a definer
  --     -rights function taking a bare UUID and a cross-division read of APP
  --     item descriptions, lot names and PR numbers over PostgREST. Anchored
  --     to the comparison: a bare '%get_user_division_id%' would still pass
  --     if the call were left in a dead SELECT list or a comment.
  IF v_src !~ 'division_id\s*=\s*procurements\.get_user_division_id\(\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp_has_inflight_procurement is no longer scoped to the caller''s division -- as a SECURITY DEFINER function on PostgREST it now leaks APP items and PR numbers across divisions';
  END IF;

  -- 1b. The lot predicate names only statuses that EXIST. app_lots.status
  --     CHECK is ('draft','finalized','in_procurement'); the plan's original
  --     NOT IN ('draft','composed') named a value that has never existed.
  --     Asserted positively AND the phantom value asserted absent, so a
  --     revert to the NOT IN form fails on both counts.
  IF v_src !~ 'status\s+IN\s*\(\s*''finalized''\s*,\s*''in_procurement''\s*\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp_has_inflight_procurement no longer selects lots by status IN (''finalized'',''in_procurement'')';
  END IF;

  IF v_src LIKE '%composed%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp_has_inflight_procurement references an app_lots status ''composed'' that does not exist in the CHECK constraint';
  END IF;

  -- 1c. The PR arm. Two separate properties: it joins pr_items on
  --     app_item_id (dropping this loses the whole second UNION arm, and the
  --     lot-status arm alone would still return rows, so the count check in
  --     create_ppmp_amendment would not notice), and it excludes only
  --     'cancelled'. Widening that exclusion -- e.g. to also skip 'completed'
  --     or 'draft' -- is the plausible rewrite, and the equality anchor
  --     catches it.
  IF v_src !~ 'pi\.app_item_id\s*=\s*ai\.id' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp_has_inflight_procurement no longer joins pr_items on app_item_id -- live PRs pointing at soft-deleted APP items are invisible to the guard';
  END IF;

  IF v_src !~ 'pr\.status\s*<>\s*''cancelled''' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp_has_inflight_procurement no longer filters PRs with pr.status <> ''cancelled'' exactly';
  END IF;

  -- ----------------------------------------------------------------
  -- 2. ppmp.amend_override
  -- ----------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM procurements.permissions WHERE code = 'ppmp.amend_override'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp.amend_override permission not seeded';
  END IF;

  -- Seeded to a role, or nobody can ever force and the override is dead code.
  -- roles keys on `name`; there is no roles.code column.
  SELECT COUNT(*) INTO v_n
    FROM procurements.role_permissions rp
    JOIN procurements.roles       r ON r.id = rp.role_id
    JOIN procurements.permissions p ON p.id = rp.permission_id
   WHERE p.code = 'ppmp.amend_override'
     AND r.name IN ('division_admin','bac_chair');

  IF v_n <> 2 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp.amend_override granted to % of the 2 intended roles (division_admin, bac_chair)',
      v_n;
  END IF;

  -- ----------------------------------------------------------------
  -- 3. create_ppmp_amendment signature
  -- ----------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname  = 'procurements'
       AND p.proname  = 'create_ppmp_amendment'
       AND p.pronargs = 3
  ) THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment 3-arg signature missing';
  END IF;

  -- The 2-arg form MUST be gone, not merely superseded. Left in place beside
  -- a 3-arg overload whose third argument has a DEFAULT, every 2-argument
  -- call -- which is every call the application makes -- fails with
  -- "function procurements.create_ppmp_amendment(uuid, text) is not unique".
  -- This is the assertion that catches a re-application of 20260803 or of
  -- 20240505 on top of this migration.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname  = 'procurements'
       AND p.proname  = 'create_ppmp_amendment'
       AND p.pronargs = 2
  ) THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: the 2-arg create_ppmp_amendment(UUID, TEXT) still exists alongside the 3-arg form -- every 2-argument call is now ambiguous and will fail';
  END IF;

  -- p_force must keep its DEFAULT. src/lib/actions/ppmp.ts and any other
  -- PostgREST caller may send only p_ppmp_id and p_justification; without the
  -- default those calls stop resolving entirely.
  SELECT p.pronargdefaults INTO v_ndefaults
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname  = 'procurements'
     AND p.proname  = 'create_ppmp_amendment'
     AND p.pronargs = 3;

  IF v_ndefaults < 1 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment p_force has no DEFAULT -- existing 2-argument RPC calls will no longer resolve';
  END IF;

  -- ----------------------------------------------------------------
  -- 4. create_ppmp_amendment body
  -- ----------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname  = 'procurements'
     AND p.proname  = 'create_ppmp_amendment'
     AND p.pronargs = 3;

  v_src := regexp_replace(v_def, '--[^' || chr(10) || ']*', '', 'g');

  -- 4a. The guard is actually invoked. Anchored to the CALL, with its
  --     argument: the function name alone appears in this body's comments
  --     (stripped) and would also survive as a bare mention.
  IF v_src !~ 'procurements\.ppmp_has_inflight_procurement\s*\(\s*p_ppmp_id\s*\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment does not call ppmp_has_inflight_procurement(p_ppmp_id)';
  END IF;

  -- 4b. The block is a GUARD, not a log line: without p_force it must raise.
  IF v_src !~ 'IF\s+NOT\s+p_force\s+THEN' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment has no `IF NOT p_force THEN` branch -- in-flight procurement no longer blocks the amendment';
  END IF;

  -- 4c. Forcing is permissioned. Anchored to the negated call, so moving the
  --     check into a comment, or inverting it to `IF has_permission(...)`,
  --     both fail.
  IF v_src !~ 'NOT\s+procurements\.has_permission\s*\(\s*''ppmp\.amend_override''\s*\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment no longer requires ppmp.amend_override to force past in-flight procurement';
  END IF;

  -- 4d. Forcing leaves an audit trail. This is the only durable record that a
  --     human knowingly orphaned a live PR.
  IF v_src NOT LIKE '%approval_logs%' OR v_src NOT LIKE '%Amendment Override%' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment no longer writes an ''Amendment Override'' approval_logs entry when forced';
  END IF;

  -- 4e. RAISE format strings support only % and %%. %L and %I belong to
  --     format(), and in a RAISE they emit the value followed by a stray
  --     literal L or I -- which in this message would print an unquoted UUID
  --     inside the SELECT the user is being told to copy and run.
  IF v_src ~ 'RAISE[^;]*%[LI]' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment uses a %%L/%%I placeholder in a RAISE -- RAISE is not format(), so it emits an unquoted value plus a stray letter';
  END IF;

  -- ----------------------------------------------------------------
  -- 5. ppmp_lots clone fidelity (bug P-1).
  --
  --    procurements.ppmp_lots has 22 columns: 16 from 20240505:82-113 plus 6
  --    from 20260516:25,34. The clone must carry 19 of them -- all but id,
  --    created_at and updated_at, with ppmp_project_id rebound to the cloned
  --    parent. 20260516 added its six and did NOT update this list, so every
  --    amendment reset is_cse to its NOT NULL DEFAULT false and blanked
  --    schedule_quarter and the four GPPB dates.
  --
  --    This section does what a substring check cannot: it extracts both
  --    lists and walks them INDEX BY INDEX. `INSERT (a,b) VALUES (y,x)` is
  --    valid SQL that runs clean and writes wrong data forever, and the five
  --    consecutive TEXT schedule columns plus the TEXT run
  --    procurement_start/procurement_end/delivery_period/source_of_funds are
  --    exactly where such a transposition would hide.
  --
  --    The [^)] classes are safe because neither list contains a parenthesis
  --    -- no casts, no function calls. If one is ever added, this extraction
  --    silently truncates, and the length check below is what catches it.
  -- ----------------------------------------------------------------
  SELECT regexp_match(
           v_src,
           'INSERT\s+INTO\s+procurements\.ppmp_lots\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)'
         )
    INTO v_ins;

  IF v_ins IS NULL THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: could not locate the ppmp_lots clone INSERT ... VALUES in create_ppmp_amendment';
  END IF;

  v_cols := string_to_array(regexp_replace(v_ins[1], '\s', '', 'g'), ',');
  v_vals := string_to_array(regexp_replace(v_ins[2], '\s', '', 'g'), ',');

  IF array_length(v_cols, 1) <> 19 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp_lots clone lists % columns, expected 19 (22 table columns less id, created_at, updated_at)',
      array_length(v_cols, 1);
  END IF;

  IF array_length(v_vals, 1) <> array_length(v_cols, 1) THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp_lots clone has % columns but % values',
      array_length(v_cols, 1), array_length(v_vals, 1);
  END IF;

  -- Position 1 is the only one that is not a straight copy: the clone must be
  -- attached to the NEW project, not to v_lot_rec.ppmp_project_id (which
  -- would silently re-parent every cloned lot onto the OLD version).
  IF v_cols[1] <> 'ppmp_project_id' OR v_vals[1] <> 'v_new_project_id' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp_lots clone position 1 is (%) := (%), expected (ppmp_project_id) := (v_new_project_id)',
      v_cols[1], v_vals[1];
  END IF;

  -- Positions 2..19 must be a straight v_lot_rec.<same column> copy. This is
  -- the transposition check.
  FOR i IN 2 .. array_length(v_cols, 1) LOOP
    IF v_vals[i] <> 'v_lot_rec.' || v_cols[i] THEN
      RAISE EXCEPTION
        'ASSERTION FAILED: ppmp_lots clone is POSITIONALLY MISALIGNED at index %: column % receives % (expected v_lot_rec.%)',
        i, v_cols[i], v_vals[i], v_cols[i];
    END IF;
  END LOOP;

  -- And the six columns 20260516 added are present at all. Checked against
  -- the extracted column list, not against the function source: the comment
  -- block above the clone names all six by design, so a source-level LIKE
  -- would pass even with every one of them deleted from the INSERT.
  FOREACH v_col IN ARRAY v_expected LOOP
    IF NOT (v_col = ANY (v_cols)) THEN
      v_missing := v_missing || ' ' || v_col;
    END IF;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: ppmp_lots clone dropped the 20260516 columns:% -- every amendment will reclassify CSE lots as non-CSE and blank the GPPB schedule dates, and auto_populate_app_from_ppmp will carry the loss into the APP',
      v_missing;
  END IF;

  -- 5a. The clones this task must NOT have touched. ppmp_lot_items'
  --     estimated_total_cost is GENERATED ALWAYS ... STORED; naming it in an
  --     INSERT is an immediate error, so its absence is deliberate.
  IF v_src ~ 'INSERT\s+INTO\s+procurements\.ppmp_lot_items[^;]*estimated_total_cost' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: the ppmp_lot_items clone names estimated_total_cost, which is GENERATED ALWAYS ... STORED and cannot be inserted';
  END IF;

  -- 5b. Task 4's stage-write removal must survive this rewrite. The
  --     ppmp_versions clone must not write indicative_final: copying the
  --     pre-20260803 body back would reinstate it, and this file is the only
  --     thing that would notice.
  IF v_src ~ 'INSERT\s+INTO\s+procurements\.ppmp_versions\s*\([^)]*indicative_final' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: create_ppmp_amendment writes indicative_final again -- a pre-20260803 body has been restored over Task 4''s stage-write removal';
  END IF;
END $$;

SELECT 'PASS: 20260809_amendment_guards' AS result;
