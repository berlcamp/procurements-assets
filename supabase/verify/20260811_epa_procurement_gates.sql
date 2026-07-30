-- Assertions for 20260811_epa_procurement_gates.sql
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/verify/20260811_epa_procurement_gates.sql
-- The trailing SELECT prints PASS even after the DO block aborts, so without
-- ON_ERROR_STOP you MUST read the whole output.

DO $$
DECLARE
  v_src TEXT;
  v_n   INTEGER;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. appropriation_exists() exists and reads the right ceiling stages.
  -- ---------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'appropriation_exists';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: appropriation_exists() missing';
  END IF;

  -- Anchored on the stage predicate, not on the bare word 'gaa', which also
  -- appears in the function's own comment and would pass vacuously.
  IF v_src !~ 'stage\s+IN\s*\(\s*''gaa''\s*,\s*''final''\s*\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: appropriation_exists does not test stage IN (gaa, final)';
  END IF;

  IF v_src !~ 'is_authoritative' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: appropriation_exists ignores is_authoritative, so a superseded '
      'ceiling would satisfy the contract-signing gate';
  END IF;

  -- ---------------------------------------------------------------
  -- 2. EXACTLY ONE create_purchase_request.
  --
  --    Two overloads sharing a parameter-name set make every PostgREST call
  --    ambiguous ("function is not unique"), and would leave a second ungated
  --    path into purchase requests. This is the assertion that keeps the
  --    duplicate from creeping back.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'create_purchase_request';

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: expected exactly 1 create_purchase_request, found %. '
      'Overloads sharing a parameter-name set make every named-argument call ambiguous.', v_n;
  END IF;

  -- ...and it is the signature the application actually calls.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements'
       AND p.proname = 'create_purchase_request'
       AND pg_get_function_identity_arguments(p.oid)
           = 'p_office_id uuid, p_purpose text, p_fiscal_year_id uuid, p_items jsonb'
  ) THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: the surviving create_purchase_request is not the signature '
      'src/lib/actions/procurement.ts calls (p_office_id, p_purpose, p_fiscal_year_id, p_items)';
  END IF;

  -- ---------------------------------------------------------------
  -- 3. Both PR entry points gate on lot release, and neither still gates on
  --    the APP status. Checking only the first would miss add_pr_item, which
  --    would then silently be the stricter path.
  -- ---------------------------------------------------------------
  FOR v_src IN
    SELECT pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements'
       AND p.proname IN ('create_purchase_request','add_pr_item')
  LOOP
    IF v_src !~ 'status\s+IN\s*\(\s*''released''\s*,\s*''in_procurement''\s*\)' THEN
      RAISE EXCEPTION
        'ASSERTION FAILED: a PR entry point does not gate on the lot being released';
    END IF;

    -- The retired gate, with comments stripped so this migration's own
    -- explanatory prose cannot trip it. Both comment forms are handled.
    IF regexp_replace(
         regexp_replace(v_src, '/\*.*?\*/', '', 'gs'), '--[^\n]*', '', 'g'
       ) ~ '''approved''\s*,\s*''posted''' THEN
      RAISE EXCEPTION
        'ASSERTION FAILED: a PR entry point still gates on the APP status being '
        'approved/posted. That is the gate this migration removes -- it makes EPA impossible.';
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 4. The contract-signing gate, keyed on the STAGE rather than on any one
  --    procurement method ('contract_signing' appears in four method stage
  --    lists, so a method-specific check would leave three ways round it).
  -- ---------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'advance_procurement_stage';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: advance_procurement_stage() missing';
  END IF;

  IF v_src !~ 'p_next_stage\s*=\s*''contract_signing''\s*\n?\s*AND NOT procurements\.appropriation_exists' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: advance_procurement_stage has no contract-signing appropriation '
      'gate keyed on p_next_stage. EPA would be able to sign contracts before the GAA.';
  END IF;
END $$;

SELECT 'PASS: 20260811_epa_procurement_gates' AS result;
