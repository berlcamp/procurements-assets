-- =============================================================================
-- Phase 9.2 — Record Performance Security
--
-- Adds the RPC behind the BAC Secretariat's "Record Performance Security"
-- dialog. The columns themselves (performance_security_form, _reference,
-- _amount, _received_at) were created in 20260419_bid_performance_security.sql
-- but no API existed for the Secretariat to actually fill them in.
--
-- The existing stage gate in advance_procurement_stage already blocks the
-- noa_issued → contract_signing transition until performance_security_received_at
-- is non-null, so this RPC + a small UI close the loop.
-- =============================================================================

CREATE OR REPLACE FUNCTION procurements.record_performance_security(
  p_procurement_id UUID,
  p_amount         NUMERIC,
  p_form           TEXT,
  p_reference      TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc RECORD;
BEGIN
  IF NOT procurements.has_permission('proc.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions: only the BAC Secretariat can record performance security';
  END IF;

  SELECT * INTO v_proc
    FROM procurements.procurement_activities
   WHERE id          = p_procurement_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Procurement activity % not found', p_procurement_id;
  END IF;

  IF v_proc.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot record performance security on a % procurement', v_proc.status;
  END IF;

  -- Recording is meaningful from the moment the bidder posts the security
  -- (typically right after NOA receipt) up to contract signing. Gate the
  -- stage to noa_issued or contract_signing only.
  IF v_proc.current_stage NOT IN ('noa_issued', 'contract_signing') THEN
    RAISE EXCEPTION 'Performance security can only be recorded at the noa_issued or contract_signing stage (current: %)', v_proc.current_stage;
  END IF;

  IF NOT v_proc.performance_security_required THEN
    RAISE EXCEPTION 'Performance security is not required for this procurement';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Performance security amount must be greater than zero';
  END IF;

  IF p_form IS NULL OR p_form NOT IN (
    'cash','bank_draft','managers_check','irrevocable_loc','surety_bond','bank_guarantee'
  ) THEN
    RAISE EXCEPTION 'Invalid performance security form: %. Allowed: cash, bank_draft, managers_check, irrevocable_loc, surety_bond, bank_guarantee', p_form;
  END IF;

  IF COALESCE(LENGTH(TRIM(p_reference)), 0) = 0 THEN
    RAISE EXCEPTION 'Performance security reference (check no, bond no, etc.) is required';
  END IF;

  UPDATE procurements.procurement_activities
     SET performance_security_amount      = p_amount,
         performance_security_form        = p_form,
         performance_security_reference   = TRIM(p_reference),
         performance_security_received_at = NOW(),
         updated_at                       = NOW()
   WHERE id = p_procurement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.record_performance_security(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
