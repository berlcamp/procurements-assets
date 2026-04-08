-- Phase 8: Procurement Workflows (SVP + Shopping) — Triggers

-- ============================================================
-- 1. updated_at triggers (reuse existing set_updated_at function)
-- ============================================================

CREATE TRIGGER trg_procurement_activities_updated_at
  BEFORE UPDATE ON procurements.procurement_activities
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_bids_updated_at
  BEFORE UPDATE ON procurements.bids
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();
