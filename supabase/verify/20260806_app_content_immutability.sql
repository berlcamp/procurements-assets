DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'app_version_is_editable'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_version_is_editable() missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_app_items_immutable_when_locked'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_app_items_immutable_when_locked missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_prevent_approved_app_version_update'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_prevent_approved_app_version_update missing';
  END IF;
END $$;

SELECT 'PASS: 20260806_app_content_immutability' AS result;
