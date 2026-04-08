-- Backfill: link PR-FIN-BUDGET-2026-0001 and its OBR to Budget Section allocation
-- and debit obligated_amount that was missed due to missing budget_allocation_id at certification time.
--
-- Allocation: 91a2eeff-2f91-4b18-8eaf-0e6917b0fdc2 (Budget Section, General Fund, 1060401000)
-- Amount: 2.00

DO $$
DECLARE
  v_alloc_id   UUID := '91a2eeff-2f91-4b18-8eaf-0e6917b0fdc2';
  v_pr_id      UUID;
  v_obr_id     UUID;
  v_amount     NUMERIC(15,2);
  v_available  NUMERIC(15,2);
BEGIN
  -- Resolve PR
  SELECT id, total_estimated_cost
    INTO v_pr_id, v_amount
    FROM procurements.purchase_requests
   WHERE pr_number   = 'PR-FIN-BUDGET-2026-0001'
     AND deleted_at  IS NULL;

  IF v_pr_id IS NULL THEN
    RAISE EXCEPTION 'PR-FIN-BUDGET-2026-0001 not found';
  END IF;

  IF (SELECT budget_allocation_id FROM procurements.purchase_requests WHERE id = v_pr_id) IS NOT NULL THEN
    RAISE EXCEPTION 'PR already has a budget_allocation_id — aborting to avoid double-debit';
  END IF;

  -- Resolve OBR
  SELECT id INTO v_obr_id
    FROM procurements.obligation_requests
   WHERE obr_number  = 'OBR-FIN-BUDGET-2026-0001'
     AND deleted_at  IS NULL;

  IF v_obr_id IS NULL THEN
    RAISE EXCEPTION 'OBR-FIN-BUDGET-2026-0001 not found';
  END IF;

  -- Guard: sufficient available balance
  SELECT adjusted_amount - obligated_amount
    INTO v_available
    FROM procurements.budget_allocations
   WHERE id         = v_alloc_id
     AND deleted_at IS NULL;

  IF COALESCE(v_available, 0) < v_amount THEN
    RAISE EXCEPTION 'Insufficient available balance. Available: %, Required: %', v_available, v_amount;
  END IF;

  -- Link PR
  UPDATE procurements.purchase_requests
     SET budget_allocation_id = v_alloc_id,
         updated_at            = NOW()
   WHERE id = v_pr_id;

  -- Link OBR and debit allocation
  UPDATE procurements.obligation_requests
     SET budget_allocation_id = v_alloc_id,
         updated_at            = NOW()
   WHERE id = v_obr_id;

  UPDATE procurements.budget_allocations
     SET obligated_amount = obligated_amount + v_amount,
         updated_at       = NOW()
   WHERE id = v_alloc_id;

  RAISE NOTICE 'Backfill complete. PR %, OBR % linked to allocation %. Obligated: %',
    'PR-FIN-BUDGET-2026-0001', 'OBR-FIN-BUDGET-2026-0001', v_alloc_id, v_amount;
END;
$$;
