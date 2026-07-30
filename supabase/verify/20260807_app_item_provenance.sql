DO $$
DECLARE
  v_dupes INTEGER;
  v_amend_def TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name = 'app_items'
       AND column_name = 'source_ppmp_version_id'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_items.source_ppmp_version_id missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'procurements'
       AND indexname = 'idx_app_items_unique_item_number'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: unique item_number index missing';
  END IF;

  SELECT COUNT(*) INTO v_dupes FROM (
    SELECT app_version_id, item_number
      FROM procurements.app_items
     WHERE deleted_at IS NULL
     GROUP BY app_version_id, item_number
    HAVING COUNT(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % duplicate (app_version_id, item_number) groups remain', v_dupes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'remap_app_amendment_lots'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: remap_app_amendment_lots() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements'
       AND c.relname = 'app_items'
       AND t.tgname  = 'trg_app_items_immutable_when_locked'
       AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_app_items_immutable_when_locked is disabled — the backfill left the immutability guard off';
  END IF;

  -- create_app_amendment must clone every app_items column, including ones
  -- added by later migrations. 20260729 (source_ppmp_lot_item_ids) and
  -- 20260519 (indicative_budget, budget_adjusted_by, budget_adjusted_at)
  -- both added columns without updating this function, so amendments
  -- silently dropped them. Guard against the same omission recurring.
  SELECT pg_get_functiondef(p.oid) INTO v_amend_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'create_app_amendment';

  IF v_amend_def IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() missing';
  END IF;

  IF v_amend_def NOT LIKE '%source_ppmp_lot_item_ids%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() does not clone source_ppmp_lot_item_ids';
  END IF;

  IF v_amend_def NOT LIKE '%indicative_budget%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() does not clone indicative_budget';
  END IF;

  IF v_amend_def NOT LIKE '%budget_adjusted_by%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() does not clone budget_adjusted_by';
  END IF;

  IF v_amend_def NOT LIKE '%budget_adjusted_at%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() does not clone budget_adjusted_at';
  END IF;
END $$;

SELECT 'PASS: 20260807_app_item_provenance' AS result;
