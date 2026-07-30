DO $$
DECLARE
  v_tbl TEXT;
  v_func_def TEXT;
  v_raise_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'ppmp_version_is_editable'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp_version_is_editable() missing';
  END IF;

  FOREACH v_tbl IN ARRAY ARRAY['ppmp_projects','ppmp_lots','ppmp_lot_items'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'procurements'
         AND c.relname = v_tbl
         AND t.tgname = 'trg_' || v_tbl || '_immutable_when_locked'
    ) THEN
      RAISE EXCEPTION 'ASSERTION FAILED: immutability trigger missing on %', v_tbl;
    END IF;
  END LOOP;

  -- Check prevent_locked_ppmp_content_change function exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'prevent_locked_ppmp_content_change'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: prevent_locked_ppmp_content_change() missing';
  END IF;

  -- Strengthened assertions on the function body to catch regressions and typos.
  -- These are heuristic checks, not a proof of correctness, but they catch obvious defects.
  v_func_def := pg_get_functiondef('procurements.prevent_locked_ppmp_content_change()'::regprocedure);

  -- Check for IS DISTINCT FROM - guards against inversion typo
  IF v_func_def NOT LIKE '%IS DISTINCT FROM%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: prevent_locked_ppmp_content_change() missing IS DISTINCT FROM check';
  END IF;

  -- Check for TG_OP - guards against regression to NEW-only COALESCE form
  IF v_func_def NOT LIKE '%TG_OP%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: prevent_locked_ppmp_content_change() missing TG_OP check';
  END IF;

  -- Check for at least two RAISE EXCEPTION statements.
  -- This is a heuristic guard: it does not guarantee both OLD and NEW sides are checked correctly,
  -- but it catches a guard reduced to a single path or overly simplified.
  v_raise_count := (
    SELECT COUNT(*)
      FROM regexp_split_to_table(v_func_def, E'\n') AS line
     WHERE line LIKE '%RAISE EXCEPTION%'
  );

  IF v_raise_count < 2 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: prevent_locked_ppmp_content_change() appears to have fewer than two RAISE EXCEPTION statements (expected for OLD and NEW sides)';
  END IF;
END $$;

SELECT 'PASS: 20260805_ppmp_content_immutability' AS result;
