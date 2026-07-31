-- ============================================================
-- Release the unused portion of an obligation once the contract amount is
-- known.
--
-- Obligating at OBR certification is correct -- that is what "certification of
-- availability of funds" means, and it is left untouched. What was missing:
-- when the winning bid lands below ABC, nothing releases the difference.
-- obligated_amount stayed at the PR estimate forever, overstating obligations
-- and understating the balance available for the rest of the year. Real budget
-- officers issue an adjusted ORS.
--
-- WHY A TRIGGER AND NOT AN RPC EDIT: procurement_activities.contract_amount is
-- written by FIVE different award paths (20260407:552, 20260420:359,
-- 20260421:118, 20260422:487, 20260428:670). A trigger on the column covers all
-- of them and any future one; patching five RPCs would leave the next one out.
-- ============================================================

BEGIN;

ALTER TABLE procurements.obligation_requests
  ADD COLUMN IF NOT EXISTS adjusted_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT,
  ADD COLUMN IF NOT EXISTS adjusted_at TIMESTAMPTZ;

COMMENT ON COLUMN procurements.obligation_requests.adjusted_amount IS
  'Obligation restated to the actual contract amount. NULL means never adjusted, and `amount` still applies. Anything reading the effective obligation must use COALESCE(adjusted_amount, amount).';
COMMENT ON COLUMN procurements.obligation_requests.adjustment_reason IS
  'Why the obligation was restated, and how much was released back to the allocation.';

-- ============================================================
-- Restate the obligation and release the difference.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.adjust_obligation_to_contract(
  p_procurement_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc            RECORD;
  v_obr             RECORD;
  v_effective_prior NUMERIC(15,2);
  v_delta           NUMERIC(15,2);
BEGIN
  SELECT * INTO v_proc
    FROM procurements.procurement_activities
   WHERE id = p_procurement_id;

  IF NOT FOUND OR v_proc.contract_amount IS NULL OR v_proc.contract_amount <= 0 THEN
    RETURN 0;
  END IF;

  -- Matched on purchase_request_id: obligation_requests.procurement_id exists
  -- but is not populated by create_obligation_request
  -- (20260408_procurement_rpc.sql:364), whereas purchase_request_id always is,
  -- and procurement_activities.purchase_request_id is NOT NULL.
  SELECT * INTO v_obr
    FROM procurements.obligation_requests
   WHERE purchase_request_id = v_proc.purchase_request_id
     AND status IN ('certified','obligated')
     AND deleted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1;

  -- No certified obligation to restate. Awarding without one is a separate
  -- problem; do not make it this trigger's business.
  IF NOT FOUND OR v_obr.budget_allocation_id IS NULL THEN
    RETURN 0;
  END IF;

  -- What is currently sitting against the allocation for this OBR. Uses the
  -- adjusted figure when present so a second award (a re-award, or a corrected
  -- contract amount) restates from the CURRENT position rather than releasing
  -- the same money twice.
  v_effective_prior := COALESCE(v_obr.adjusted_amount, v_obr.amount);
  v_delta := v_proc.contract_amount - v_effective_prior;

  IF v_delta = 0 THEN
    RETURN 0;
  END IF;

  -- Never silently increase an obligation past what was certified.
  --
  -- NOTE this RAISE aborts the awarding transaction, because it runs in an
  -- AFTER UPDATE trigger on procurement_activities. That is deliberate: awarding
  -- above the certified obligation would commit the division to money no budget
  -- officer has certified. The message names the remedy.
  IF v_delta > 0 THEN
    RAISE EXCEPTION
      'Contract amount (%) exceeds the certified obligation (%) for OBR %. '
      'A supplemental obligation must be certified by the Budget Officer before this '
      'award can be recorded.',
      v_proc.contract_amount, v_effective_prior, v_obr.obr_number;
  END IF;

  -- budget_allocations carries trg_budget_alloc_sync_saro and
  -- trg_budget_alloc_sync_sub_aro, but both fire only on
  -- UPDATE OF saro_id, original_amount, deleted_at. This statement touches
  -- neither, so it cascades nowhere. Verified against pg_trigger.
  UPDATE procurements.budget_allocations
     SET obligated_amount = GREATEST(0, obligated_amount + v_delta),
         updated_at       = NOW()
   WHERE id = v_obr.budget_allocation_id
     AND deleted_at IS NULL;

  -- Writes no `status`, so trg_obr_budget_sync (AFTER UPDATE OF status) cannot
  -- fire and cannot double-apply the release.
  UPDATE procurements.obligation_requests
     SET adjusted_amount   = v_proc.contract_amount,
         adjustment_reason = 'Restated to awarded contract amount. Released '
                             || ABS(v_delta)::TEXT || ' back to the allocation.',
         adjusted_at       = NOW(),
         updated_at        = NOW()
   WHERE id = v_obr.id;

  RETURN ABS(v_delta);
END;
$$;

COMMENT ON FUNCTION procurements.adjust_obligation_to_contract(UUID) IS
  'Restates the obligation to the awarded contract amount and releases the difference back to the allocation. Refuses to increase an obligation past what was certified.';

CREATE OR REPLACE FUNCTION procurements.adjust_obligation_on_award()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  IF NEW.contract_amount IS NOT NULL
     AND NEW.contract_amount > 0
     AND (OLD.contract_amount IS NULL
          OR OLD.contract_amount <> NEW.contract_amount) THEN
    PERFORM procurements.adjust_obligation_to_contract(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_adjust_obligation_on_award ON procurements.procurement_activities;
CREATE TRIGGER trg_adjust_obligation_on_award
  AFTER UPDATE OF contract_amount ON procurements.procurement_activities
  FOR EACH ROW
  EXECUTE FUNCTION procurements.adjust_obligation_on_award();

-- ============================================================
-- Teach the existing OBR->budget sync about adjusted_amount.
--
-- NOT IN THE PLAN, and required. sync_obr_to_budget_allocation reverses a
-- cancelled OBR by subtracting NEW.amount -- the ORIGINAL certified figure.
-- Once an obligation has been restated downward, only the ADJUSTED amount is
-- still sitting against the allocation, so cancelling would release the
-- difference a SECOND time. The existing GREATEST(0, ...) floor would clamp the
-- result and hide the error, leaving the allocation reporting more available
-- budget than it actually has.
--
-- Body is the LIVE definition, with only the cancellation arm changed.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.sync_obr_to_budget_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'procurements', 'platform', 'auth', 'public'
AS $function$
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
  --
  -- 20260816: reverse the EFFECTIVE obligation, not the original amount.
  -- adjust_obligation_to_contract may already have released the difference
  -- between the certified amount and the awarded contract. Subtracting
  -- NEW.amount here would release that difference a SECOND time, and the
  -- GREATEST(0, ...) floor would hide it by silently clamping -- leaving the
  -- allocation showing more available budget than it has.
  ELSIF NEW.status = 'cancelled' AND OLD.status IN ('certified', 'obligated') THEN
    IF NEW.budget_allocation_id IS NOT NULL THEN
      UPDATE procurements.budget_allocations
         SET obligated_amount = GREATEST(0, obligated_amount - COALESCE(NEW.adjusted_amount, NEW.amount)),
             updated_at       = NOW()
       WHERE id = NEW.budget_allocation_id
         AND deleted_at IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
