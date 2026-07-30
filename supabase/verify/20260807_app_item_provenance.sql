DO $$
DECLARE
  v_dupes INTEGER;
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
END $$;

SELECT 'PASS: 20260807_app_item_provenance' AS result;
