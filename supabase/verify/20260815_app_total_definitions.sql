-- Assertions for 20260815_app_total_definitions.sql
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/verify/20260815_app_total_definitions.sql
-- The trailing SELECT prints PASS even after the DO block aborts, so without
-- ON_ERROR_STOP you MUST read the whole output.

DO $$
DECLARE
  v_src TEXT;
  v_bad INTEGER;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. The column
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'procurements'
       AND table_name   = 'app_versions'
       AND column_name  = 'total_approved_cost'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: app_versions.total_approved_cost missing';
  END IF;

  -- ---------------------------------------------------------------
  -- 2. total_estimated_cost = EVERY non-deleted item.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_bad
    FROM procurements.app_versions av
   WHERE av.total_estimated_cost <> COALESCE((
     SELECT SUM(ai.estimated_budget) FROM procurements.app_items ai
      WHERE ai.app_version_id = av.id AND ai.deleted_at IS NULL
   ), 0);

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % versions have a stale total_estimated_cost', v_bad;
  END IF;

  -- ---------------------------------------------------------------
  -- 3. total_approved_cost = HOPE-approved items only.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_bad
    FROM procurements.app_versions av
   WHERE av.total_approved_cost <> COALESCE((
     SELECT SUM(ai.estimated_budget) FROM procurements.app_items ai
      WHERE ai.app_version_id = av.id
        AND ai.deleted_at IS NULL
        AND ai.hope_review_status = 'approved'
   ), 0);

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % versions have a stale total_approved_cost', v_bad;
  END IF;

  -- ---------------------------------------------------------------
  -- 4. finalize_app no longer writes a total.
  --
  --    This is the whole point: it used to put the APPROVED-ONLY sum into
  --    total_estimated_cost, giving that column two meanings depending on
  --    whether the version had been finalized yet.
  -- ---------------------------------------------------------------
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^\n]*', '', 'g'
         ) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'finalize_app';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: finalize_app() missing';
  END IF;

  IF v_src ~ 'total_estimated_cost' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: finalize_app still writes total_estimated_cost. That is the '
      'third definition this migration removes.';
  END IF;

  -- Task 11's composition gate must survive the rewrite.
  IF v_src !~ 'status\s*=\s*''draft''' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: finalize_app lost the draft-lot composition gate from 20260810';
  END IF;

  -- ---------------------------------------------------------------
  -- 5. P1: both sides recomputed.
  --
  --    app_items.app_version_id is updatable and create_app_amendment moves
  --    items between versions, so COALESCE(NEW, OLD) would leave the source
  --    version's totals overstated.
  -- ---------------------------------------------------------------
  SELECT regexp_replace(
           regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
           '--[^\n]*', '', 'g'
         ) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'procurements' AND p.proname = 'recalc_app_version_total';

  IF v_src ~ 'COALESCE\s*\(\s*NEW\.app_version_id\s*,\s*OLD\.app_version_id\s*\)' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: recalc_app_version_total resolves the version with '
      'COALESCE(NEW.app_version_id, OLD.app_version_id). Moving an item between versions '
      'would leave the source overstated. Recompute both sides.';
  END IF;

  IF v_src !~ 'total_approved_cost' THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: recalc_app_version_total does not maintain total_approved_cost';
  END IF;

  -- ---------------------------------------------------------------
  -- 6. A review-outcome change must move the approved total. Without this
  --    trigger the figure only updates when an item row is written, so
  --    approving an item would leave the APP total unchanged.
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements' AND c.relname = 'app_items'
       AND t.tgname = 'trg_recalc_app_totals_on_review' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_recalc_app_totals_on_review missing';
  END IF;

  -- ---------------------------------------------------------------
  -- 7. *** THE SUSPENDED GUARD IS BACK ON. ***
  -- ---------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements' AND c.relname = 'app_versions'
       AND t.tgname = 'trg_prevent_approved_app_version_update'
       AND t.tgenabled = 'D'
  ) THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: trg_prevent_approved_app_version_update is still DISABLED after '
      'the backfill. Approved APP content is unprotected until it is re-enabled.';
  END IF;
END $$;

SELECT 'PASS: 20260815_app_total_definitions' AS result;
