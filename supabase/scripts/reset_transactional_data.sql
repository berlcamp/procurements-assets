-- =============================================================================
-- RESET TRANSACTIONAL DATA FOR RE-TESTING
-- =============================================================================
-- Wipes all user-created procurement data (planning, budget, PR, procurement
-- activities, POs, inventory, assets, requests, notifications, audit trail)
-- while preserving: divisions, users, roles, permissions, offices, fiscal
-- years, fund sources, account codes, system settings, announcements.
--
-- USAGE:
--   1. Review the list below and comment out any domain you want to keep.
--   2. Run in the Supabase SQL editor (service role / owner).
--   3. This uses TRUNCATE ... CASCADE so it:
--        - runs fast
--        - resets identity sequences (RESTART IDENTITY)
--        - skips row-level DELETE triggers (so budget-sync / PO-sync side
--          effects will NOT fire — correct for a full wipe)
--      Audit triggers that write to audit.audit_logs are also skipped; the
--      audit table itself is truncated separately below.
--
-- SAFETY:
--   - Wrap in BEGIN/COMMIT. Run SELECTs first if you want to preview counts.
--   - This is DESTRUCTIVE and not reversible. DO NOT run in production.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Assets / Inventory (child ledgers first)
-- -----------------------------------------------------------------------------
TRUNCATE TABLE
    procurements.depreciation_records,
    procurements.asset_assignments,
    procurements.assets,
    procurements.stock_movements,
    procurements.inventory,
    procurements.item_catalog
RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- 2. Purchase Orders / Deliveries
-- -----------------------------------------------------------------------------
TRUNCATE TABLE
    procurements.delivery_items,
    procurements.deliveries,
    procurements.po_items,
    procurements.purchase_orders
RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- 3. Procurement Activities (BAC bids, evaluations, stages, suppliers)
-- -----------------------------------------------------------------------------
TRUNCATE TABLE
    procurements.bid_evaluations,
    procurements.bid_items,
    procurements.bids,
    procurements.procurement_lots,
    procurements.procurement_stages,
    procurements.procurement_activities,
    procurements.supplier_documents,
    procurements.suppliers
RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- 4. End-user Requests (RIS)
-- -----------------------------------------------------------------------------
TRUNCATE TABLE
    procurements.request_items,
    procurements.requests
RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- 5. Purchase Requests / Obligation Requests
-- -----------------------------------------------------------------------------
TRUNCATE TABLE
    procurements.obligation_requests,
    procurements.pr_items,
    procurements.purchase_requests
RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- 6. APP (Annual Procurement Plan)
-- -----------------------------------------------------------------------------
TRUNCATE TABLE
    procurements.app_lots,
    procurements.app_items,
    procurements.app_versions,
    procurements.apps
RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- 7. PPMP (Project Procurement Management Plan)
-- -----------------------------------------------------------------------------
TRUNCATE TABLE
    procurements.ppmp_lot_items,
    procurements.ppmp_lots,
    procurements.ppmp_projects,
    procurements.ppmp_versions,
    procurements.ppmps
RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- 8. Budget (adjustments first, then allocations, then Sub-ARO)
-- -----------------------------------------------------------------------------
TRUNCATE TABLE
    procurements.budget_adjustments,
    procurements.budget_allocations,
    procurements.sub_allotment_release_orders
RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- 9. Workflow / cross-cutting
-- -----------------------------------------------------------------------------
TRUNCATE TABLE
    procurements.approval_logs,
    procurements.notifications,
    procurements.documents,
    procurements.sequence_counters
RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- 10. Audit trail (optional — comment out to preserve audit history)
-- -----------------------------------------------------------------------------
TRUNCATE TABLE audit.audit_logs RESTART IDENTITY;
-- TRUNCATE TABLE platform.platform_audit_logs RESTART IDENTITY;  -- uncomment to also clear platform audit

-- -----------------------------------------------------------------------------
-- Sanity check (optional — uncomment to print remaining row counts)
-- -----------------------------------------------------------------------------
-- SELECT 'ppmps' AS table, COUNT(*) FROM procurements.ppmps
-- UNION ALL SELECT 'apps', COUNT(*) FROM procurements.apps
-- UNION ALL SELECT 'purchase_requests', COUNT(*) FROM procurements.purchase_requests
-- UNION ALL SELECT 'procurement_activities', COUNT(*) FROM procurements.procurement_activities
-- UNION ALL SELECT 'purchase_orders', COUNT(*) FROM procurements.purchase_orders
-- UNION ALL SELECT 'budget_allocations', COUNT(*) FROM procurements.budget_allocations
-- UNION ALL SELECT 'assets', COUNT(*) FROM procurements.assets
-- UNION ALL SELECT 'notifications', COUNT(*) FROM procurements.notifications;

COMMIT;

-- =============================================================================
-- NOT TOUCHED (preserved for continued testing):
--   procurements.user_profiles, procurements.user_roles
--   procurements.roles, procurements.permissions, procurements.role_permissions
--   procurements.offices, procurements.fiscal_years
--   procurements.fund_sources, procurements.account_codes
--   procurements.system_settings, procurements.announcements
--   procurements.division_join_requests
--   platform.divisions, platform.announcements
--   auth.users (Supabase Auth)
-- =============================================================================
