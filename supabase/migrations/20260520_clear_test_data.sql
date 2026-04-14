-- ============================================================
-- Clear all transactional data for fresh testing
-- Preserves: user_profiles, roles, permissions, role_permissions,
--            user_roles, offices, divisions, division_join_requests,
--            announcements, system_settings, fund_sources, account_codes,
--            procurement_method_ceilings, supplier_document_types
-- ============================================================

BEGIN;

-- ============================================================
-- 1. AUDIT & NOTIFICATIONS
-- ============================================================
TRUNCATE audit.audit_logs CASCADE;
TRUNCATE procurements.approval_logs CASCADE;
TRUNCATE procurements.notifications CASCADE;
TRUNCATE procurements.documents CASCADE;

-- ============================================================
-- 2. INVENTORY & ASSETS  (child → parent order)
-- ============================================================
TRUNCATE procurements.depreciation_records CASCADE;
TRUNCATE procurements.asset_assignments CASCADE;
TRUNCATE procurements.assets CASCADE;
TRUNCATE procurements.stock_movements CASCADE;
TRUNCATE procurements.inventory CASCADE;
TRUNCATE procurements.item_catalog CASCADE;

-- ============================================================
-- 3. PROCUREMENT  (child → parent order)
-- ============================================================
TRUNCATE procurements.delivery_items CASCADE;
TRUNCATE procurements.deliveries CASCADE;
TRUNCATE procurements.po_items CASCADE;
TRUNCATE procurements.purchase_orders CASCADE;
TRUNCATE procurements.bid_evaluations CASCADE;
TRUNCATE procurements.bid_items CASCADE;
TRUNCATE procurements.bids CASCADE;
TRUNCATE procurements.procurement_stages CASCADE;
TRUNCATE procurements.procurement_lots CASCADE;
TRUNCATE procurements.procurement_activities CASCADE;
TRUNCATE procurements.pr_items CASCADE;
TRUNCATE procurements.obligation_requests CASCADE;
TRUNCATE procurements.purchase_requests CASCADE;
TRUNCATE procurements.supplier_documents CASCADE;
TRUNCATE procurements.suppliers CASCADE;
TRUNCATE procurements.request_items CASCADE;
TRUNCATE procurements.requests CASCADE;

-- ============================================================
-- 4. PLANNING  (child → parent order)
-- ============================================================
-- APP
TRUNCATE procurements.app_lots CASCADE;
TRUNCATE procurements.app_items CASCADE;
TRUNCATE procurements.app_versions CASCADE;
TRUNCATE procurements.apps CASCADE;

-- PPMP
TRUNCATE procurements.ppmp_lot_items CASCADE;
TRUNCATE procurements.ppmp_lots CASCADE;
TRUNCATE procurements.ppmp_projects CASCADE;
TRUNCATE procurements.ppmp_versions CASCADE;
TRUNCATE procurements.ppmps CASCADE;

-- ============================================================
-- 5. BUDGET  (child → parent order)
-- ============================================================
TRUNCATE procurements.sub_allotment_release_orders CASCADE;
TRUNCATE procurements.budget_adjustments CASCADE;
TRUNCATE procurements.budget_allocations CASCADE;

-- ============================================================
-- 6. RESET SEQUENCE COUNTERS
-- ============================================================
TRUNCATE procurements.sequence_counters CASCADE;

-- ============================================================
-- 7. CLEAR PLATFORM AUDIT LOGS
-- ============================================================
TRUNCATE platform.platform_audit_logs CASCADE;

COMMIT;
