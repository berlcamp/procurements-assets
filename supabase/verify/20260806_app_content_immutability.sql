DO $$
DECLARE
  v_with_check TEXT;
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

  -- Fix round 1: catch the class of regression where an explicit WITH CHECK
  -- is supplied that is weaker than USING (e.g. omits the permission block
  -- or the super-admin bypass), which silently reopens INSERT to any
  -- authenticated division user. A NULL with_check (policy missing, or
  -- FOR ALL policy with no WITH CHECK at all) must fail these assertions,
  -- not pass them silently.
  SELECT with_check INTO v_with_check
    FROM pg_policies
   WHERE schemaname = 'procurements'
     AND tablename = 'app_items'
     AND policyname = 'division_admin_manage_app_items';

  IF v_with_check IS NULL OR v_with_check NOT LIKE '%is_super_admin%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: division_admin_manage_app_items.with_check missing is_super_admin bypass';
  END IF;

  IF v_with_check IS NULL OR v_with_check NOT LIKE '%has_permission%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: division_admin_manage_app_items.with_check missing has_permission (privilege escalation on INSERT)';
  END IF;
END $$;

SELECT 'PASS: 20260806_app_content_immutability' AS result;
