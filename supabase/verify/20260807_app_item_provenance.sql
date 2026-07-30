DO $$
DECLARE
  v_dupes INTEGER;
  v_amend_def TEXT;
  v_amend_body TEXT;
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

  -- The migration disables trg_recalc_app_version_total alongside the
  -- immutability guard, because its cascading UPDATE on app_versions trips
  -- trg_prevent_approved_app_version_update. It must be back on: while it is
  -- off, every item insert/update/delete silently stops maintaining
  -- app_versions.total_estimated_cost.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'procurements'
       AND c.relname = 'app_items'
       AND t.tgname  = 'trg_recalc_app_version_total'
       AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: trg_recalc_app_version_total is disabled — the backfill left the version-total recalculation off';
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

  -- ----------------------------------------------------------------
  -- READ THIS BEFORE TRUSTING THE CHECKS BELOW.
  --
  -- (a) They run against v_amend_body, NOT v_amend_def. pg_get_functiondef()
  --     returns the function source INCLUDING its comments, and
  --     create_app_amendment carries a long comment that NAMES all four of the
  --     restored columns precisely because it explains why they must not be
  --     dropped again. Matched against the raw definition, all four assertions
  --     below PASS on that comment text alone — so the single most likely
  --     regression (someone drops the columns from the INSERT/SELECT but leaves
  --     the comment that is about not dropping them) sails straight through.
  --     v_amend_body strips SQL line comments first so the checks see code.
  --     Add new assertions against v_amend_body; never against v_amend_def.
  --
  -- (b) A substring check can NEVER detect a POSITIONAL SWAP between the INSERT
  --     column list and the SELECT list. If someone transposes two same-typed
  --     columns — say source_ppmp_id and source_ppmp_version_id, both UUID —
  --     every assertion here still passes while every amendment silently writes
  --     each value into the other's column. Postgres will not catch it either,
  --     since the types match. Only a round-trip test (create an APP version
  --     with a DISTINCT sentinel value in every column, amend it, assert each
  --     sentinel landed in its own column) can detect that class of defect.
  --     These guards catch OMISSION, not MISALIGNMENT. Do not over-trust them.
  -- ----------------------------------------------------------------
  v_amend_body := regexp_replace(v_amend_def, '--[^' || chr(10) || ']*', '', 'g');

  IF v_amend_body NOT LIKE '%source_ppmp_version_id%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() does not clone source_ppmp_version_id';
  END IF;

  IF v_amend_body NOT LIKE '%source_ppmp_lot_item_ids%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() does not clone source_ppmp_lot_item_ids';
  END IF;

  IF v_amend_body NOT LIKE '%indicative_budget%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() does not clone indicative_budget';
  END IF;

  IF v_amend_body NOT LIKE '%budget_adjusted_by%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() does not clone budget_adjusted_by';
  END IF;

  IF v_amend_body NOT LIKE '%budget_adjusted_at%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() does not clone budget_adjusted_at';
  END IF;

  -- The lot reassignment must go through remap_app_amendment_lots(), which
  -- matches by PPMP provenance. The superseded implementation joined the old
  -- and new item sets on the DISPLAY number (old_ai.item_number), so any
  -- renumber could move money between BAC lots. That join must not come back.
  IF v_amend_body LIKE '%old_ai.item_number%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() still joins lots on the display item_number (old_ai.item_number) instead of calling remap_app_amendment_lots()';
  END IF;

  IF v_amend_body NOT LIKE '%remap_app_amendment_lots%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() does not call remap_app_amendment_lots()';
  END IF;

  -- Task 4's edits are carried by this function's body and are the thing most
  -- likely to be silently reverted by a later copy-paste of an older
  -- definition: indicative_final must NOT be written by the app_versions
  -- INSERT, and the parent APP must move to 'under_review', not 'indicative'.
  IF v_amend_body LIKE '%indicative_final%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() writes indicative_final — Task 4 removed it; an older definition has been restored over it';
  END IF;

  IF v_amend_body NOT LIKE '%under_review%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: create_app_amendment() does not reference under_review — Task 4 set the parent APP status to under_review; an older definition has been restored over it';
  END IF;
END $$;

SELECT 'PASS: 20260807_app_item_provenance' AS result;
