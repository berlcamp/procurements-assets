-- Assertions for 20260816_obligation_adjust_on_award.sql
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/verify/20260816_obligation_adjust_on_award.sql
-- The trailing SELECT prints PASS even after the DO block aborts, so without
-- ON_ERROR_STOP you MUST read the whole output.

DO $$
DECLARE
  v_src  TEXT;
  v_name TEXT;
  v_n    INTEGER;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. Columns
  -- ---------------------------------------------------------------
  FOR v_name IN SELECT unnest(ARRAY['adjusted_amount','adjustment_reason','adjusted_at'])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'procurements'
         AND table_name   = 'obligation_requests'
         AND column_name  = v_name
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: obligation_requests.% missing', v_name;
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------
  -- 2. Function and trigger
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'adjust_obligation_to_contract'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: adjust_obligation_to_contract() missing';
  END IF;

  -- Anchored to the table as well as the name: a trigger of the right name on
  -- the wrong table would satisfy a bare pg_trigger lookup.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements' AND c.relname = 'procurement_activities'
       AND t.tgname = 'trg_adjust_obligation_on_award' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: trg_adjust_obligation_on_award missing on procurement_activities';
  END IF;

  -- ---------------------------------------------------------------
  -- 3. It must refuse to INCREASE an obligation.
  --    Silently raising an obligation past what a budget officer certified is
  --    the one outcome this function must never produce.
  -- ---------------------------------------------------------------
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^\n]*', '', 'g'
         ) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'adjust_obligation_to_contract';

  IF v_src !~ 'v_delta\s*>\s*0' OR v_src !~ 'RAISE EXCEPTION' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: adjust_obligation_to_contract does not refuse an increase. '
      'An award above the certified obligation must be blocked, not absorbed.';
  END IF;

  -- It must restate from the CURRENT position, or a second award releases the
  -- same money twice.
  IF v_src !~ 'COALESCE\s*\(\s*v_obr\.adjusted_amount\s*,\s*v_obr\.amount\s*\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: adjust_obligation_to_contract does not baseline on '
      'COALESCE(adjusted_amount, amount), so a re-award would release the difference twice';
  END IF;

  -- ---------------------------------------------------------------
  -- 4. *** THE CANCELLATION PATH MUST KNOW ABOUT adjusted_amount. ***
  --
  --    sync_obr_to_budget_allocation reverses a cancelled OBR. If it still
  --    subtracts the ORIGINAL amount, cancelling an already-restated obligation
  --    releases the difference a second time — and the GREATEST(0, ...) floor
  --    clamps the result, hiding the error while the allocation reports more
  --    available budget than it has.
  -- ---------------------------------------------------------------
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^\n]*', '', 'g'
         ) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'sync_obr_to_budget_allocation';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: sync_obr_to_budget_allocation() missing';
  END IF;

  IF v_src !~ 'COALESCE\s*\(\s*NEW\.adjusted_amount\s*,\s*NEW\.amount\s*\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: sync_obr_to_budget_allocation still reverses the ORIGINAL amount '
      'on cancellation. Cancelling a restated obligation would release the difference twice.';
  END IF;

  -- The debit-on-certification arm must survive untouched.
  IF v_src !~ 'obligated_amount\s*\+' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: sync_obr_to_budget_allocation lost its debit-on-certification arm';
  END IF;

  -- ---------------------------------------------------------------
  -- 5. Data invariant: no obligation is restated UPWARD. The function refuses
  --    it, so any such row was written by another path and needs review.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_n
    FROM procurements.obligation_requests
   WHERE adjusted_amount IS NOT NULL
     AND adjusted_amount > amount;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % obligation(s) have adjusted_amount greater than the certified '
      'amount', v_n;
  END IF;

  -- Every adjustment must say why.
  SELECT COUNT(*) INTO v_n
    FROM procurements.obligation_requests
   WHERE adjusted_amount IS NOT NULL
     AND (adjustment_reason IS NULL OR LENGTH(TRIM(adjustment_reason)) = 0);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % adjustment(s) carry no reason', v_n;
  END IF;
END $$;

SELECT 'PASS: 20260816_obligation_adjust_on_award' AS result;
