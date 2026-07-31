-- Assertions for 20260818_schema_hygiene_dates.sql
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/verify/20260818_schema_hygiene_dates.sql
-- The trailing SELECT prints PASS even after the DO block aborts, so without
-- ON_ERROR_STOP you MUST read the whole output.

DO $$
DECLARE
  v_missing  TEXT;
  v_unparsed INTEGER;
  v_n        INTEGER;
BEGIN
  -- ---------------------------------------------------------------
  -- 1. All twelve DATE columns exist, on both tables.
  -- ---------------------------------------------------------------
  SELECT string_agg(t || '.' || c, ', ')
    INTO v_missing
    FROM (VALUES
      ('ppmp_lots','procurement_start_date'),
      ('ppmp_lots','procurement_end_date'),
      ('ppmp_lots','advertisement_date_d'),
      ('ppmp_lots','bid_opening_date_d'),
      ('ppmp_lots','award_date_d'),
      ('ppmp_lots','contract_signing_date_d'),
      ('app_items','procurement_start_date'),
      ('app_items','procurement_end_date'),
      ('app_items','advertisement_date_d'),
      ('app_items','bid_opening_date_d'),
      ('app_items','award_date_d'),
      ('app_items','contract_signing_date_d')
    ) AS x(t, c)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'procurements'
        AND table_name   = x.t
        AND column_name  = x.c
        AND data_type    = 'date'
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: missing DATE columns: %', v_missing;
  END IF;

  -- ---------------------------------------------------------------
  -- 2. The parser exists and behaves. Tested by CALLING it, not by grepping
  --    its body — a parser is the one thing that can be checked directly.
  -- ---------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'procurements' AND p.proname = 'parse_mm_yyyy'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: parse_mm_yyyy() missing';
  END IF;

  IF procurements.parse_mm_yyyy('03/2027')     IS DISTINCT FROM DATE '2027-03-01' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: parse_mm_yyyy(''03/2027'') did not give 2027-03-01';
  END IF;
  IF procurements.parse_mm_yyyy('3/2027')      IS DISTINCT FROM DATE '2027-03-01' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: parse_mm_yyyy(''3/2027'') did not give 2027-03-01';
  END IF;
  IF procurements.parse_mm_yyyy('2027-03-15')  IS DISTINCT FROM DATE '2027-03-15' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: parse_mm_yyyy ISO form did not round-trip';
  END IF;
  IF procurements.parse_mm_yyyy('03/15/2027')  IS DISTINCT FROM DATE '2027-03-15' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: parse_mm_yyyy MM/DD/YYYY form did not round-trip';
  END IF;
  -- Must NOT guess.
  IF procurements.parse_mm_yyyy('Q1 2027')     IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: parse_mm_yyyy guessed at an unrecognised value';
  END IF;
  IF procurements.parse_mm_yyyy('')            IS NOT NULL
     OR procurements.parse_mm_yyyy('   ')      IS NOT NULL
     OR procurements.parse_mm_yyyy(NULL)       IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: parse_mm_yyyy did not treat empty/NULL as NULL';
  END IF;

  -- ---------------------------------------------------------------
  -- 3. Every parseable legacy value actually converted, on BOTH tables.
  --    The plan checked only ppmp_lots.procurement_start.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_unparsed
    FROM procurements.ppmp_lots
   WHERE procurements.parse_mm_yyyy(procurement_start) IS NOT NULL
     AND procurement_start_date IS NULL;
  IF v_unparsed > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % ppmp_lots rows have a parseable procurement_start that did not convert',
      v_unparsed;
  END IF;

  SELECT COUNT(*) INTO v_unparsed
    FROM procurements.app_items
   WHERE procurements.parse_mm_yyyy(procurement_start) IS NOT NULL
     AND procurement_start_date IS NULL;
  IF v_unparsed > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % app_items rows have a parseable procurement_start that did not convert',
      v_unparsed;
  END IF;

  -- ---------------------------------------------------------------
  -- 4. *** EVERY SUSPENDED TRIGGER IS BACK ON. ***
  --
  --    Three, not two. trg_recalc_app_version_total has no column list, so the
  --    app_items backfill fires it and it cascades an UPDATE into app_versions
  --    where the approved-version guard lives — the same indirect collision that
  --    aborted 20260807. Leaving any of the three off silently unprotects
  --    approved plan content.
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
  -- 5. The backfill must not have disturbed the APP totals. If
  --    trg_recalc_app_version_total had been left enabled and somehow
  --    succeeded, or if the backfill touched a column it should not, this
  --    catches the drift.
  -- ---------------------------------------------------------------
  SELECT COUNT(*) INTO v_n
    FROM procurements.app_versions av
   WHERE av.total_estimated_cost <> COALESCE((
     SELECT SUM(ai.estimated_budget) FROM procurements.app_items ai
      WHERE ai.app_version_id = av.id AND ai.deleted_at IS NULL
   ), 0);
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ASSERTION FAILED: % app_versions have a total_estimated_cost inconsistent with their '
      'items after the date backfill', v_n;
  END IF;
END $$;

SELECT 'PASS: 20260818_schema_hygiene_dates' AS result;
