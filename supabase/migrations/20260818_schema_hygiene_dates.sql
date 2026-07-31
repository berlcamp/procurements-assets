-- ============================================================
-- Schedule fields as real dates.
--
-- MM/YYYY strings cannot support: schedule-vs-actual slippage reporting,
-- validation that activity falls inside the fiscal year, or the quarterly APP
-- schedule roll-ups DBM and GPPB expect.
--
-- Additive: the TEXT originals stay and are marked deprecated. A later cleanup
-- migration drops them once every read path uses the DATE columns. The four
-- *_date columns already exist as TEXT, so the new DATE columns take a _d
-- suffix; that cleanup migration renames them.
--
-- NOTE 20260817 is deliberately unused. The File Structure table lists a
-- secretariat_review_step migration at that number, but the BAC Secretariat
-- conformity review is explicitly DEFERRED to a separate plan, so no task
-- produces it. The gap is intentional, not a missing file.
-- ============================================================

BEGIN;

-- ============================================================
-- Best-effort parser. Returns NULL rather than guessing.
--
-- Genuinely IMMUTABLE: every branch uses TO_DATE with an explicit format.
-- The obvious `v_clean::DATE` for the ISO branch would NOT be -- the text->date
-- cast is only STABLE because it reads the DateStyle GUC -- and mislabelling
-- volatility lets the planner cache a result that a session setting can change.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.parse_mm_yyyy(p_text TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean TEXT;
BEGIN
  IF p_text IS NULL THEN RETURN NULL; END IF;

  v_clean := TRIM(p_text);
  IF v_clean = '' THEN RETURN NULL; END IF;

  -- MM/YYYY or M/YYYY -> first day of that month
  IF v_clean ~ '^\d{1,2}/\d{4}$' THEN
    RETURN TO_DATE(LPAD(SPLIT_PART(v_clean, '/', 1), 2, '0')
                   || '/01/' || SPLIT_PART(v_clean, '/', 2), 'MM/DD/YYYY');
  END IF;

  -- YYYY-MM-DD
  IF v_clean ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN TO_DATE(v_clean, 'YYYY-MM-DD');
  END IF;

  -- MM/DD/YYYY
  IF v_clean ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
    RETURN TO_DATE(v_clean, 'FMMM/FMDD/YYYY');
  END IF;

  -- Unrecognised: leave NULL rather than guess. The migration's follow-up query
  -- reports every distinct unparsed value so nothing goes silently missing.
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- TO_DATE accepts some impossible dates and rejects others; a value that
  -- matched the shape but is not a real date lands here.
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION procurements.parse_mm_yyyy(TEXT) IS
  'Best-effort conversion of legacy schedule strings (MM/YYYY, YYYY-MM-DD, MM/DD/YYYY) to DATE. Returns NULL rather than guessing.';

ALTER TABLE procurements.ppmp_lots
  ADD COLUMN IF NOT EXISTS procurement_start_date   DATE,
  ADD COLUMN IF NOT EXISTS procurement_end_date     DATE,
  ADD COLUMN IF NOT EXISTS advertisement_date_d     DATE,
  ADD COLUMN IF NOT EXISTS bid_opening_date_d       DATE,
  ADD COLUMN IF NOT EXISTS award_date_d             DATE,
  ADD COLUMN IF NOT EXISTS contract_signing_date_d  DATE;

ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS procurement_start_date   DATE,
  ADD COLUMN IF NOT EXISTS procurement_end_date     DATE,
  ADD COLUMN IF NOT EXISTS advertisement_date_d     DATE,
  ADD COLUMN IF NOT EXISTS bid_opening_date_d       DATE,
  ADD COLUMN IF NOT EXISTS award_date_d             DATE,
  ADD COLUMN IF NOT EXISTS contract_signing_date_d  DATE;

COMMENT ON COLUMN procurements.ppmp_lots.procurement_start IS
  'DEPRECATED: free-text MM/YYYY. Use procurement_start_date.';
COMMENT ON COLUMN procurements.ppmp_lots.procurement_end IS
  'DEPRECATED: free-text MM/YYYY. Use procurement_end_date.';
COMMENT ON COLUMN procurements.app_items.procurement_start IS
  'DEPRECATED: free-text MM/YYYY. Use procurement_start_date.';
COMMENT ON COLUMN procurements.app_items.procurement_end IS
  'DEPRECATED: free-text MM/YYYY. Use procurement_end_date.';

-- ============================================================
-- Backfill.
--
-- P2, WIDENED FORM. The plan suspended only the two immutability guards. That
-- is NOT enough for app_items.
--
--   trg_app_items_immutable_when_locked   BEFORE I/U/D. Raises on any write to
--       an item under a final/approved/superseded version. Suspended.
--   trg_recalc_app_version_total          AFTER INSERT OR UPDATE OR DELETE,
--       *** NO COLUMN LIST ***, so this backfill FIRES IT. Its body issues an
--       unconditional UPDATE of procurements.app_versions, which trips
--       trg_prevent_approved_app_version_update (raises when OLD.status =
--       NEW.status = 'approved'). The first app_item under any approved version
--       would abort the whole migration. This is the identical indirect
--       collision that broke 20260807 (Task 8's C1) and it must be suspended
--       too. Suppressing it is provably a no-op: recalc reads only
--       estimated_budget, app_version_id, deleted_at and hope_review_status,
--       and this backfill writes none of them, so every suppressed recomputation
--       would have been a byte-identical write.
--   trg_recalc_app_totals_on_review       AFTER UPDATE OF hope_review_status.
--       Not written here, so it cannot fire. Left ON deliberately.
--   trg_update_app_status_on_item_insert  AFTER INSERT only. Cannot fire on an
--       UPDATE. Left ON.
--
-- procurements.ppmp_lots carries only audit and updated_at besides its guard;
-- neither cascades into a guarded table.
--
-- ON OWNERSHIP: ALTER TABLE ... DISABLE TRIGGER requires table ownership. The
-- plan flagged this as an open question. It is settled empirically -- 20260802
-- and 20260807 both used scoped DISABLE/ENABLE and were applied successfully to
-- the live database. No session-flag alternative is needed.
--
-- This file is wrapped in BEGIN/COMMIT and DISABLE TRIGGER is transactional, so
-- a failure restores every guard. The verify script asserts all three are back.
-- ============================================================

ALTER TABLE procurements.ppmp_lots DISABLE TRIGGER trg_ppmp_lots_immutable_when_locked;
ALTER TABLE procurements.app_items DISABLE TRIGGER trg_app_items_immutable_when_locked;
ALTER TABLE procurements.app_items DISABLE TRIGGER trg_recalc_app_version_total;

UPDATE procurements.ppmp_lots
   SET procurement_start_date  = procurements.parse_mm_yyyy(procurement_start),
       procurement_end_date    = procurements.parse_mm_yyyy(procurement_end),
       advertisement_date_d    = procurements.parse_mm_yyyy(advertisement_date),
       bid_opening_date_d      = procurements.parse_mm_yyyy(bid_opening_date),
       award_date_d            = procurements.parse_mm_yyyy(award_date),
       contract_signing_date_d = procurements.parse_mm_yyyy(contract_signing_date);

UPDATE procurements.app_items
   SET procurement_start_date  = procurements.parse_mm_yyyy(procurement_start),
       procurement_end_date    = procurements.parse_mm_yyyy(procurement_end),
       advertisement_date_d    = procurements.parse_mm_yyyy(advertisement_date),
       bid_opening_date_d      = procurements.parse_mm_yyyy(bid_opening_date),
       award_date_d            = procurements.parse_mm_yyyy(award_date),
       contract_signing_date_d = procurements.parse_mm_yyyy(contract_signing_date);

ALTER TABLE procurements.app_items ENABLE TRIGGER trg_recalc_app_version_total;
ALTER TABLE procurements.app_items ENABLE TRIGGER trg_app_items_immutable_when_locked;
ALTER TABLE procurements.ppmp_lots ENABLE TRIGGER trg_ppmp_lots_immutable_when_locked;

CREATE INDEX IF NOT EXISTS idx_ppmp_lots_proc_start ON procurements.ppmp_lots(procurement_start_date);
CREATE INDEX IF NOT EXISTS idx_app_items_proc_start ON procurements.app_items(procurement_start_date);

COMMIT;
