-- Phase 8.5 Step 4 — Bid Security and Performance Security
--
-- RA 12009 IRR mandates:
--   * Bid Security at submission for Competitive Bidding (1-2% of ABC,
--     depending on form). May be waived for SVP/Shopping.
--   * Performance Security from the winning bidder before contract
--     signing (5% cash / 30% surety bond, etc.).
--
-- This migration adds the columns + the per-method ceiling rules. It
-- does NOT yet hard-block bid recording — that gate will be added in
-- Phase 9 when the bid-record dialog is extended to capture security
-- details. For now, the data shape is in place and a soft validator
-- function is provided.
--
-- Non-destructive.

-- ============================================================
-- 1. Add security configuration to procurement_method_ceilings
-- ============================================================
ALTER TABLE procurements.procurement_method_ceilings
  ADD COLUMN IF NOT EXISTS requires_bid_security        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bid_security_percentage      NUMERIC(5,4),  -- e.g. 0.0200 = 2%
  ADD COLUMN IF NOT EXISTS requires_performance_security BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS performance_security_percentage NUMERIC(5,4); -- e.g. 0.0500 = 5%

COMMENT ON COLUMN procurements.procurement_method_ceilings.requires_bid_security IS
  'Whether bidders must post a bid security at submission (RA 12009 IRR Sec 27).';
COMMENT ON COLUMN procurements.procurement_method_ceilings.bid_security_percentage IS
  'Bid security as a fraction of ABC. RA 12009 IRR commonly: 0.02 for cash/bank draft, higher for surety bond.';
COMMENT ON COLUMN procurements.procurement_method_ceilings.requires_performance_security IS
  'Whether the winning bidder must post performance security before contract signing.';
COMMENT ON COLUMN procurements.procurement_method_ceilings.performance_security_percentage IS
  'Performance security as a fraction of contract amount. RA 12009 IRR commonly: 0.05 cash, 0.30 surety bond.';

-- Seed defaults — verify against latest GPPB Resolution.
UPDATE procurements.procurement_method_ceilings SET
  requires_bid_security           = TRUE,
  bid_security_percentage         = 0.0200,
  requires_performance_security   = TRUE,
  performance_security_percentage = 0.0500
WHERE procurement_mode = 'competitive_bidding';

UPDATE procurements.procurement_method_ceilings SET
  requires_bid_security           = FALSE,
  bid_security_percentage         = NULL,
  requires_performance_security   = TRUE,
  performance_security_percentage = 0.0500
WHERE procurement_mode IN ('svp', 'shopping', 'negotiated', 'direct_contracting',
                            'repeat_order', 'emergency', 'agency_to_agency');

-- ============================================================
-- 2. Bid security columns on bids
-- ============================================================
ALTER TABLE procurements.bids
  ADD COLUMN IF NOT EXISTS bid_security_amount      NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS bid_security_form        TEXT,
  ADD COLUMN IF NOT EXISTS bid_security_reference   TEXT,
  ADD COLUMN IF NOT EXISTS bid_security_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bid_security_returned_at TIMESTAMPTZ;

ALTER TABLE procurements.bids
  DROP CONSTRAINT IF EXISTS chk_bid_security_form;
ALTER TABLE procurements.bids
  ADD CONSTRAINT chk_bid_security_form
    CHECK (
      bid_security_form IS NULL
      OR bid_security_form IN ('cash','bank_draft','managers_check','irrevocable_loc','surety_bond','bank_guarantee')
    );

COMMENT ON COLUMN procurements.bids.bid_security_amount IS
  'Amount of bid security posted by the bidder.';
COMMENT ON COLUMN procurements.bids.bid_security_form IS
  'Form: cash | bank_draft | managers_check | irrevocable_loc | surety_bond | bank_guarantee';
COMMENT ON COLUMN procurements.bids.bid_security_reference IS
  'Reference number on the bid security instrument (check no, bond no, etc.).';
COMMENT ON COLUMN procurements.bids.bid_security_received_at IS
  'When the BAC Secretariat received the bid security.';
COMMENT ON COLUMN procurements.bids.bid_security_returned_at IS
  'When the bid security was returned to the bidder (typically after award to winner / loss to others).';

-- ============================================================
-- 3. Performance security columns on procurement_activities
-- ============================================================
ALTER TABLE procurements.procurement_activities
  ADD COLUMN IF NOT EXISTS performance_security_required    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS performance_security_amount      NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS performance_security_form        TEXT,
  ADD COLUMN IF NOT EXISTS performance_security_reference   TEXT,
  ADD COLUMN IF NOT EXISTS performance_security_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS performance_security_returned_at TIMESTAMPTZ;

ALTER TABLE procurements.procurement_activities
  DROP CONSTRAINT IF EXISTS chk_performance_security_form;
ALTER TABLE procurements.procurement_activities
  ADD CONSTRAINT chk_performance_security_form
    CHECK (
      performance_security_form IS NULL
      OR performance_security_form IN ('cash','bank_draft','managers_check','irrevocable_loc','surety_bond','bank_guarantee')
    );

-- ============================================================
-- 4. Snapshot performance_security_required on activity creation
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.snapshot_performance_security_requirement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_required BOOLEAN;
BEGIN
  IF NEW.performance_security_required THEN
    RETURN NEW;
  END IF;

  SELECT requires_performance_security INTO v_required
    FROM procurements.procurement_method_ceilings
   WHERE procurement_mode = NEW.procurement_method;

  IF v_required IS NOT NULL THEN
    NEW.performance_security_required := v_required;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_perf_security_snapshot ON procurements.procurement_activities;
CREATE TRIGGER trg_perf_security_snapshot
  BEFORE INSERT ON procurements.procurement_activities
  FOR EACH ROW
  EXECUTE FUNCTION procurements.snapshot_performance_security_requirement();

-- Backfill for existing activities
UPDATE procurements.procurement_activities pa
   SET performance_security_required = c.requires_performance_security
  FROM procurements.procurement_method_ceilings c
 WHERE c.procurement_mode = pa.procurement_method
   AND pa.performance_security_required = FALSE;

-- ============================================================
-- 5. Helper: bid_security_status(bid_id) → JSONB
--    Returns { required, posted, sufficient, required_amount, posted_amount }
--    Used by Phase 9 UI to render security status before submission.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.bid_security_status(p_bid_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_bid       RECORD;
  v_proc      RECORD;
  v_ceiling   RECORD;
  v_required_amt NUMERIC;
BEGIN
  SELECT * INTO v_bid FROM procurements.bids WHERE id = p_bid_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Bid not found');
  END IF;

  SELECT * INTO v_proc FROM procurements.procurement_activities WHERE id = v_bid.procurement_id;
  SELECT * INTO v_ceiling FROM procurements.procurement_method_ceilings WHERE procurement_mode = v_proc.procurement_method;

  IF NOT v_ceiling.requires_bid_security THEN
    RETURN jsonb_build_object(
      'required', FALSE,
      'posted',   v_bid.bid_security_amount IS NOT NULL,
      'sufficient', TRUE,
      'required_amount', NULL,
      'posted_amount',   v_bid.bid_security_amount
    );
  END IF;

  v_required_amt := v_proc.abc_amount * COALESCE(v_ceiling.bid_security_percentage, 0.02);

  RETURN jsonb_build_object(
    'required',         TRUE,
    'posted',           v_bid.bid_security_amount IS NOT NULL,
    'sufficient',       (v_bid.bid_security_amount IS NOT NULL AND v_bid.bid_security_amount >= v_required_amt),
    'required_amount',  v_required_amt,
    'posted_amount',    v_bid.bid_security_amount,
    'form',             v_bid.bid_security_form
  );
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.bid_security_status(UUID) TO authenticated;

-- ============================================================
-- 6. Helper: required_performance_security_amount(procurement_id) → NUMERIC
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.required_performance_security_amount(p_procurement_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_proc      RECORD;
  v_ceiling   RECORD;
BEGIN
  SELECT * INTO v_proc FROM procurements.procurement_activities WHERE id = p_procurement_id;
  IF NOT FOUND OR v_proc.contract_amount IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_ceiling FROM procurements.procurement_method_ceilings WHERE procurement_mode = v_proc.procurement_method;

  IF NOT v_ceiling.requires_performance_security THEN
    RETURN NULL;
  END IF;

  RETURN v_proc.contract_amount * COALESCE(v_ceiling.performance_security_percentage, 0.05);
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.required_performance_security_amount(UUID) TO authenticated;
