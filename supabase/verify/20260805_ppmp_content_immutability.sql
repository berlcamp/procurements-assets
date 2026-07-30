DO $$
DECLARE
  v_tbl TEXT;
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
END $$;

SELECT 'PASS: 20260805_ppmp_content_immutability' AS result;
