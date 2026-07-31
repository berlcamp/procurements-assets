-- ============================================================
-- Fund source as an FK, and orphan permission cleanup.
--
-- source_of_funds TEXT sat on ppmp_lots and app_items alongside a real
-- budget_allocation_id FK and a real fund_sources table -- free text where an
-- FK exists, so fund-source reporting was impossible.
--
-- Additive: the TEXT originals stay and are marked deprecated. Task 20 Step 7
-- keeps writing source_of_funds for one release so existing reports render.
-- ============================================================

BEGIN;

ALTER TABLE procurements.ppmp_lots
  ADD COLUMN IF NOT EXISTS fund_source_id UUID
    REFERENCES procurements.fund_sources(id);

ALTER TABLE procurements.app_items
  ADD COLUMN IF NOT EXISTS fund_source_id UUID
    REFERENCES procurements.fund_sources(id);

COMMENT ON COLUMN procurements.ppmp_lots.source_of_funds IS
  'DEPRECATED: free text. Use fund_source_id.';
COMMENT ON COLUMN procurements.app_items.source_of_funds IS
  'DEPRECATED: free text. Use fund_source_id.';

CREATE INDEX IF NOT EXISTS idx_ppmp_lots_fund_source ON procurements.ppmp_lots(fund_source_id);
CREATE INDEX IF NOT EXISTS idx_app_items_fund_source ON procurements.app_items(fund_source_id);

-- ============================================================
-- Backfills.
--
-- P2, WIDENED FORM -- and the plan makes the SAME omission as Task 19.
-- It suspends only the two immutability guards.
-- trg_recalc_app_version_total is AFTER INSERT OR UPDATE OR DELETE on app_items
-- with NO COLUMN LIST, so the app_items backfill FIRES IT, and its body issues
-- an unconditional UPDATE of app_versions which trips
-- trg_prevent_approved_app_version_update. The first app_item under any
-- approved version aborts the migration. Reproduced against 20260818 before
-- writing this one.
--
-- Suppressing the recalc is provably a no-op here too: it reads only
-- estimated_budget, app_version_id, deleted_at and hope_review_status, and
-- these backfills write only fund_source_id.
--
-- trg_recalc_app_totals_on_review (AFTER UPDATE OF hope_review_status) and
-- trg_update_app_status_on_item_insert (AFTER INSERT) cannot fire on these
-- statements and are deliberately left ON.
--
-- ppmp_lots carries only audit and updated_at besides its guard; neither
-- cascades into a guarded table.
--
-- Ownership for DISABLE TRIGGER is settled: 20260802 and 20260807 used the same
-- pattern and were applied successfully to the live database.
-- ============================================================

ALTER TABLE procurements.ppmp_lots DISABLE TRIGGER trg_ppmp_lots_immutable_when_locked;
ALTER TABLE procurements.app_items DISABLE TRIGGER trg_app_items_immutable_when_locked;
ALTER TABLE procurements.app_items DISABLE TRIGGER trg_recalc_app_version_total;

-- Backfill 1 (most reliable): via the linked budget allocation.
UPDATE procurements.ppmp_lots pl
   SET fund_source_id = ba.fund_source_id
  FROM procurements.budget_allocations ba
 WHERE ba.id = pl.budget_allocation_id
   AND pl.fund_source_id IS NULL;

UPDATE procurements.app_items ai
   SET fund_source_id = ba.fund_source_id
  FROM procurements.budget_allocations ba
 WHERE ba.id = ai.budget_allocation_id
   AND ai.fund_source_id IS NULL;

-- Backfill 2 (best effort): exact case-insensitive name or code match.
-- procurements.fund_sources has BOTH name and code (implementer note verified),
-- so both halves of the predicate are valid.
UPDATE procurements.ppmp_lots pl
   SET fund_source_id = fs.id
  FROM procurements.fund_sources fs
 WHERE pl.fund_source_id IS NULL
   AND pl.source_of_funds IS NOT NULL
   AND (LOWER(TRIM(pl.source_of_funds)) = LOWER(TRIM(fs.name))
        OR LOWER(TRIM(pl.source_of_funds)) = LOWER(TRIM(fs.code)));

UPDATE procurements.app_items ai
   SET fund_source_id = fs.id
  FROM procurements.fund_sources fs
 WHERE ai.fund_source_id IS NULL
   AND ai.source_of_funds IS NOT NULL
   AND (LOWER(TRIM(ai.source_of_funds)) = LOWER(TRIM(fs.name))
        OR LOWER(TRIM(ai.source_of_funds)) = LOWER(TRIM(fs.code)));

ALTER TABLE procurements.app_items ENABLE TRIGGER trg_recalc_app_version_total;
ALTER TABLE procurements.app_items ENABLE TRIGGER trg_app_items_immutable_when_locked;
ALTER TABLE procurements.ppmp_lots ENABLE TRIGGER trg_ppmp_lots_immutable_when_locked;

-- ============================================================
-- Remove the four permission codes nothing checks.
--
-- Independently confirmed before deleting: each code has ZERO references
-- anywhere in supabase/migrations/ or src/ outside its own seed row.
--
-- Enforced equivalents, seeded later, are:
--   ppmp.review_chief  -> ppmp.chief_review    (20240502_ppmp_rls.sql:11)
--   ppmp.certify       -> ppmp.certify_budget  (20240502_ppmp_rls.sql:12)
--   app.review_rows    -> app.hope_review      (20240602_app_rls.sql:10)
--   app.finalize_lots  -> app.bac_manage_lots  (20240602_app_rls.sql:11)
--
-- role_permissions.permission_id is ON DELETE CASCADE (verified against
-- pg_constraint, not assumed -- a NO ACTION FK would have made this DELETE
-- fail outright). The cascade removes role assignments that grant nothing
-- today, so no behaviour changes; only the roles UI stops offering them.
-- ============================================================

DELETE FROM procurements.permissions
 WHERE code IN ('ppmp.review_chief','ppmp.certify','app.review_rows','app.finalize_lots');

COMMIT;
