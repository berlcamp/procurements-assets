-- Phase 7: Procurement Core — Triggers

-- ============================================================
-- 1. updated_at triggers (reuse existing set_updated_at function)
-- ============================================================

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON procurements.suppliers
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_prs_updated_at
  BEFORE UPDATE ON procurements.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_pr_items_updated_at
  BEFORE UPDATE ON procurements.pr_items
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_obrs_updated_at
  BEFORE UPDATE ON procurements.obligation_requests
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- ============================================================
-- 2. OBR → Budget Allocation sync trigger
--
-- When an OBR transitions to 'certified'  → debit  obligated_amount
-- When an OBR transitions to 'cancelled'  → credit obligated_amount (reverse)
-- Guard: obligated_amount cannot go below 0
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.sync_obr_to_budget_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  -- Debit on certification
  IF NEW.status = 'certified' AND OLD.status = 'pending' THEN
    IF NEW.budget_allocation_id IS NOT NULL THEN
      UPDATE procurements.budget_allocations
         SET obligated_amount = obligated_amount + NEW.amount,
             updated_at       = NOW()
       WHERE id = NEW.budget_allocation_id
         AND deleted_at IS NULL;
    END IF;

  -- Reverse on cancellation (from any active state)
  ELSIF NEW.status = 'cancelled' AND OLD.status IN ('certified', 'obligated') THEN
    IF NEW.budget_allocation_id IS NOT NULL THEN
      UPDATE procurements.budget_allocations
         SET obligated_amount = GREATEST(0, obligated_amount - NEW.amount),
             updated_at       = NOW()
       WHERE id = NEW.budget_allocation_id
         AND deleted_at IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Only fires when status column changes value
CREATE TRIGGER trg_obr_budget_sync
  AFTER UPDATE OF status ON procurements.obligation_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION procurements.sync_obr_to_budget_allocation();
