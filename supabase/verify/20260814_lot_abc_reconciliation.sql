-- Assertions for 20260814_lot_abc_reconciliation.sql
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/verify/20260814_lot_abc_reconciliation.sql
-- The trailing SELECT prints PASS even after the DO block aborts, so without
-- ON_ERROR_STOP you MUST read the whole output.

DO $$
DECLARE
  v_src   TEXT;
  v_drift INTEGER;
  v_n     INTEGER;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. Columns and the justification constraint
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements' AND table_name = 'ppmp_lots'
       AND column_name = 'abc_is_manual'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp_lots.abc_is_manual missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements' AND table_name = 'ppmp_lots'
       AND column_name = 'abc_manual_justification'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp_lots.abc_manual_justification missing';
  END IF;

  -- A manual override without a reason is just an unexplained number.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_manual_abc_has_justification'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: chk_manual_abc_has_justification missing';
  END IF;

  -- ---------------------------------------------------------------
  -- 2. The maintaining trigger exists on the right table.
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements' AND c.relname = 'ppmp_lot_items'
       AND t.tgname = 'trg_recalc_ppmp_lot_abc' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_recalc_ppmp_lot_abc missing on ppmp_lot_items';
  END IF;

  -- ---------------------------------------------------------------
  -- 3. P1: both sides must be recomputed.
  --
  --    ppmp_lot_items.ppmp_lot_id is a plain updatable FK. With
  --    COALESCE(NEW.ppmp_lot_id, OLD.ppmp_lot_id) an item moved between lots
  --    recomputes only the destination and leaves the SOURCE lot's ABC
  --    inflated by the moved item — a silently overstated bid ceiling, which
  --    is exactly what this migration exists to prevent.
  -- ---------------------------------------------------------------
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^\n]*', '', 'g'
         ) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'recalc_ppmp_lot_abc';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: recalc_ppmp_lot_abc() missing';
  END IF;

  IF v_src ~ 'COALESCE\s*\(\s*NEW\.ppmp_lot_id\s*,\s*OLD\.ppmp_lot_id\s*\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: recalc_ppmp_lot_abc resolves the lot with '
      'COALESCE(NEW.ppmp_lot_id, OLD.ppmp_lot_id). Moving an item between lots would '
      'leave the source lot overstated. Recompute both sides.';
  END IF;

  -- The manual escape hatch must actually be honoured by the trigger.
  IF v_src !~ 'abc_is_manual\s*=\s*false' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: recalc_ppmp_lot_abc does not exclude manually-set ABCs, so it '
      'would overwrite a justified lump-sum figure';
  END IF;

  -- ---------------------------------------------------------------
  -- 4. submit_ppmp enforces reconciliation.
  -- ---------------------------------------------------------------
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^\n]*', '', 'g'
         ) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'submit_ppmp';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: submit_ppmp() missing';
  END IF;

  IF v_src !~ 'abc_is_manual' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: submit_ppmp has no ABC reconciliation check';
  END IF;

  -- Task 15's version gate must survive this rewrite.
  IF v_src !~ 'has_open_amendment' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: submit_ppmp lost the open-amendment gate added in 20260813';
  END IF;

  -- ---------------------------------------------------------------
  -- 5. *** THE SUSPENDED GUARD IS BACK ON. ***
  -- ---------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements' AND c.relname = 'ppmp_lots'
       AND t.tgname = 'trg_ppmp_lots_immutable_when_locked'
       AND t.tgenabled = 'D'
  ) THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: trg_ppmp_lots_immutable_when_locked is still DISABLED after the '
      'backfill. Approved PPMP content is unprotected until it is re-enabled.';
  END IF;

  -- ---------------------------------------------------------------
  -- 6. No auto-maintained lot drifts from the sum of its lines.
  --    This is the substantive invariant; the rest is machinery.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_drift
    FROM procurements.ppmp_lots pl
   WHERE pl.abc_is_manual = false
     AND pl.estimated_budget <> COALESCE((
       SELECT SUM(pli.estimated_total_cost)
         FROM procurements.ppmp_lot_items pli
        WHERE pli.ppmp_lot_id = pl.id
     ), 0);

  IF v_drift > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % auto-maintained lots still drift from their line totals', v_drift;
  END IF;

  -- ---------------------------------------------------------------
  -- 7. Every lot flagged manual by the backfill carries its reason. The CHECK
  --    guarantees this going forward; this catches a backfill that wrote the
  --    flag without the note.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_n
    FROM procurements.ppmp_lots
   WHERE abc_is_manual = true
     AND (abc_manual_justification IS NULL OR LENGTH(TRIM(abc_manual_justification)) < 10);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % manual ABC(s) have no justification', v_n;
  END IF;
END $$;

SELECT 'PASS: 20260814_lot_abc_reconciliation' AS result;
