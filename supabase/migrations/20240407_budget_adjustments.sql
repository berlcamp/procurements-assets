-- Phase 4: budget_adjustments table
-- Records realignments, augmentations, reductions, and transfers.
-- On approval, a trigger updates budget_allocations.adjusted_amount.

CREATE TABLE IF NOT EXISTS procurements.budget_adjustments (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id           UUID          NOT NULL REFERENCES platform.divisions(id),
  budget_allocation_id  UUID          NOT NULL REFERENCES procurements.budget_allocations(id),
  office_id             UUID          NOT NULL REFERENCES procurements.offices(id),
  adjustment_type       TEXT          NOT NULL
                          CHECK (adjustment_type IN (
                            'realignment', 'augmentation', 'reduction',
                            'transfer_in', 'transfer_out'
                          )),
  amount                NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  justification         TEXT          NOT NULL,
  reference_number      TEXT,
  status                TEXT          NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by           UUID          REFERENCES auth.users(id),
  approved_at           TIMESTAMPTZ,
  remarks               TEXT,
  created_by            UUID          REFERENCES auth.users(id),
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_budget_adj_division      ON procurements.budget_adjustments(division_id);
CREATE INDEX idx_budget_adj_allocation    ON procurements.budget_adjustments(budget_allocation_id);
CREATE INDEX idx_budget_adj_office        ON procurements.budget_adjustments(office_id);
CREATE INDEX idx_budget_adj_status        ON procurements.budget_adjustments(status);
CREATE INDEX idx_budget_adj_deleted_at    ON procurements.budget_adjustments(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- Trigger: on approval, update adjusted_amount on allocation
-- Realignment / augmentation / transfer_in  → + amount
-- Reduction / transfer_out                  → - amount (floor at 0)
-- Also validates resulting balance won't go below obligated_amount.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.apply_budget_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_alloc RECORD;
  v_delta NUMERIC(15,2);
BEGIN
  -- Only fire when status transitions TO 'approved'
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Record approver timestamp
  NEW.approved_at := NOW();

  SELECT *
    INTO v_alloc
    FROM procurements.budget_allocations
   WHERE id = NEW.budget_allocation_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget allocation % not found', NEW.budget_allocation_id;
  END IF;

  -- Determine delta based on type
  v_delta := CASE NEW.adjustment_type
    WHEN 'augmentation'  THEN  NEW.amount
    WHEN 'transfer_in'   THEN  NEW.amount
    WHEN 'reduction'     THEN -NEW.amount
    WHEN 'transfer_out'  THEN -NEW.amount
    WHEN 'realignment'   THEN  0  -- realignment is neutral (handled via paired transfer_in/transfer_out)
    ELSE 0
  END;

  -- Validate resulting balance won't dip below obligated
  IF (v_alloc.adjusted_amount + v_delta) < v_alloc.obligated_amount THEN
    RAISE EXCEPTION
      'Adjustment would reduce available balance below obligated amount. Obligated: %, Adjusted would be: %',
      v_alloc.obligated_amount,
      (v_alloc.adjusted_amount + v_delta);
  END IF;

  IF (v_alloc.adjusted_amount + v_delta) < 0 THEN
    RAISE EXCEPTION 'Adjustment would make adjusted_amount negative';
  END IF;

  -- Apply delta
  UPDATE procurements.budget_allocations
     SET adjusted_amount = adjusted_amount + v_delta,
         updated_at      = NOW()
   WHERE id = NEW.budget_allocation_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_budget_adjustment
  BEFORE UPDATE OF status ON procurements.budget_adjustments
  FOR EACH ROW EXECUTE FUNCTION procurements.apply_budget_adjustment();

-- ============================================================
-- updated_at trigger
-- ============================================================

CREATE TRIGGER trg_budget_adjustments_updated_at
  BEFORE UPDATE ON procurements.budget_adjustments
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- ============================================================
-- Audit trigger
-- ============================================================

CREATE TRIGGER trg_budget_adjustments_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.budget_adjustments
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE procurements.budget_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "division_read_budget_adjustments" ON procurements.budget_adjustments
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "budget_create_adjustments" ON procurements.budget_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('budget_adjustments.create')
      OR platform.is_super_admin()
    )
    AND procurements.is_division_active()
  );

-- Only approvers (HOPE/Division Chief/Division Admin) can update status
CREATE POLICY "budget_update_adjustments" ON procurements.budget_adjustments
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('budget_adjustments.update')
      OR procurements.has_permission('budget_adjustments.approve')
      OR platform.is_super_admin()
    )
  );
