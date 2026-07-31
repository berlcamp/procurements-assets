-- Assertions for 20260819_schema_hygiene_fund_source.sql
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/verify/20260819_schema_hygiene_fund_source.sql
-- The trailing SELECT prints PASS even after the DO block aborts, so without
-- ON_ERROR_STOP you MUST read the whole output.

DO $$
DECLARE
  v_orphans INTEGER;
  v_n       INTEGER;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. Both FK columns exist, and are actually FOREIGN KEYS.
  --    A plain UUID column would satisfy a column-name check while allowing
  --    any garbage value — the exact thing this migration replaces.
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements' AND table_name = 'ppmp_lots'
       AND column_name = 'fund_source_id'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ppmp_lots.fund_source_id missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements' AND table_name = 'app_items'
       AND column_name = 'fund_source_id'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_items.fund_source_id missing';
  END IF;

  SELECT COUNT(*) INTO v_n
    FROM pg_constraint c
    JOIN pg_class t     ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'procurements'
     AND t.relname IN ('ppmp_lots','app_items')
     AND c.contype = 'f'
     AND c.confrelid = 'procurements.fund_sources'::regclass;

  IF v_n < 2 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: expected a fund_sources FK on both ppmp_lots and app_items, found %.'
      ' A bare UUID column would accept values that are not fund sources.', v_n;
  END IF;

  -- ---------------------------------------------------------------
  -- 2. The four orphan permission codes are gone.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_orphans
    FROM procurements.permissions
   WHERE code IN ('ppmp.review_chief','ppmp.certify','app.review_rows','app.finalize_lots');

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % orphan permission codes still present', v_orphans;
  END IF;

  -- ...and so are their role assignments (the FK cascade did its job).
  SELECT COUNT(*) INTO v_n
    FROM procurements.role_permissions rp
    LEFT JOIN procurements.permissions p ON p.id = rp.permission_id
   WHERE p.id IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % role_permissions rows point at a deleted permission', v_n;
  END IF;

  -- ---------------------------------------------------------------
  -- 3. The codes that ARE enforced must survive. Deleting a live code by
  --    mistake would silently strip real access.
  -- ---------------------------------------------------------------
  FOR v_n IN SELECT 1 LOOP END LOOP;  -- no-op, keeps the block shape uniform

  IF (SELECT COUNT(*) FROM procurements.permissions
       WHERE code IN ('ppmp.chief_review','ppmp.certify_budget',
                      'app.hope_review','app.bac_manage_lots')) <> 4 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: one or more ENFORCED permission codes are missing. The cleanup '
      'must remove only the four orphans, never their working equivalents.';
  END IF;

  -- ---------------------------------------------------------------
  -- 4. Backfill sanity: no row may reference a fund source that does not
  --    exist. The FK guarantees it, so a failure here means the constraint
  --    was dropped.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_n
    FROM procurements.ppmp_lots pl
   WHERE pl.fund_source_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM procurements.fund_sources fs WHERE fs.id = pl.fund_source_id);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % ppmp_lots reference a nonexistent fund source', v_n;
  END IF;

  -- Where a budget allocation is linked, its fund source must have won: that
  -- is the authoritative backfill and it must not have been overwritten by the
  -- weaker name match.
  SELECT COUNT(*) INTO v_n
    FROM procurements.ppmp_lots pl
    JOIN procurements.budget_allocations ba ON ba.id = pl.budget_allocation_id
   WHERE pl.fund_source_id IS DISTINCT FROM ba.fund_source_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % ppmp_lots disagree with their budget allocation''s fund source', v_n;
  END IF;

  -- ---------------------------------------------------------------
  -- 5. *** EVERY SUSPENDED TRIGGER IS BACK ON. ***
  --     Three, for the same reason as 20260818.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_n
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'procurements'
     AND ((c.relname = 'ppmp_lots' AND t.tgname = 'trg_ppmp_lots_immutable_when_locked')
       OR (c.relname = 'app_items' AND t.tgname IN ('trg_app_items_immutable_when_locked',
                                                    'trg_recalc_app_version_total')))
     AND t.tgenabled = 'D';

  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % trigger(s) suspended by this migration are still DISABLED', v_n;
  END IF;

  -- ---------------------------------------------------------------
  -- 6. The backfill must not have disturbed the APP totals.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_n
    FROM procurements.app_versions av
   WHERE av.total_estimated_cost <> COALESCE((
     SELECT SUM(ai.estimated_budget) FROM procurements.app_items ai
      WHERE ai.app_version_id = av.id AND ai.deleted_at IS NULL
   ), 0);
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % app_versions have totals inconsistent with their items after the '
      'fund-source backfill', v_n;
  END IF;
END $$;

SELECT 'PASS: 20260819_schema_hygiene_fund_source' AS result;
