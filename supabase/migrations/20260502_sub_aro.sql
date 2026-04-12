-- Sub-Allotment Release Order (Sub-ARO) tracking
-- Models the fund authority chain: DepEd Central/Regional ARO → Division Sub-ARO → Budget Allocations

-- ============================================================
-- procurements.sub_allotment_release_orders
-- Tracks Sub-AROs received by the Division from Central/Regional.
-- Budget allocations reference this as their funding authority.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.sub_allotment_release_orders (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id       UUID          NOT NULL REFERENCES platform.divisions(id),
  fiscal_year_id    UUID          NOT NULL REFERENCES procurements.fiscal_years(id),

  -- ARO/Sub-ARO identifiers
  sub_aro_number    TEXT          NOT NULL,
  aro_number        TEXT,                      -- Parent ARO from Central/Regional (optional)

  -- Classification
  allotment_class   TEXT          NOT NULL DEFAULT 'current'
                      CHECK (allotment_class IN ('current', 'continuing')),
  fund_source_id    UUID          NOT NULL REFERENCES procurements.fund_sources(id),

  -- Authority details
  releasing_office  TEXT,                      -- e.g. "DepEd Region IV-A", "DepEd Central Office"
  release_date      DATE,
  validity_date     DATE,                      -- Expiry/validity of the allotment
  purpose           TEXT,                      -- Description/purpose of the release

  -- Amounts
  total_amount      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  allocated_amount  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  -- allocated_amount = SUM of linked budget_allocations.original_amount
  -- Maintained by trigger

  -- Status
  status            TEXT          NOT NULL DEFAULT 'active'
                      CHECK (status IN ('draft', 'active', 'fully_allocated', 'expired', 'cancelled')),

  -- Document reference
  document_url      TEXT,                      -- Storage path for the signed Sub-ARO PDF

  -- Audit
  remarks           TEXT,
  created_by        UUID          REFERENCES auth.users(id),
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (division_id, sub_aro_number)
);

CREATE INDEX idx_sub_aros_division_id     ON procurements.sub_allotment_release_orders(division_id);
CREATE INDEX idx_sub_aros_fiscal_year     ON procurements.sub_allotment_release_orders(fiscal_year_id);
CREATE INDEX idx_sub_aros_fund_source     ON procurements.sub_allotment_release_orders(fund_source_id);
CREATE INDEX idx_sub_aros_status          ON procurements.sub_allotment_release_orders(status);
CREATE INDEX idx_sub_aros_allotment_class ON procurements.sub_allotment_release_orders(allotment_class);
CREATE INDEX idx_sub_aros_deleted_at      ON procurements.sub_allotment_release_orders(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE procurements.sub_allotment_release_orders ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Add sub_aro_id FK to budget_allocations
-- ============================================================
ALTER TABLE procurements.budget_allocations
  ADD COLUMN sub_aro_id UUID REFERENCES procurements.sub_allotment_release_orders(id);

CREATE INDEX idx_budget_alloc_sub_aro ON procurements.budget_allocations(sub_aro_id);

-- ============================================================
-- Triggers
-- ============================================================

-- 1. updated_at
CREATE TRIGGER trg_sub_aros_updated_at
  BEFORE UPDATE ON procurements.sub_allotment_release_orders
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- 2. Audit
CREATE TRIGGER trg_audit_sub_aros
  AFTER INSERT OR UPDATE OR DELETE ON procurements.sub_allotment_release_orders
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- 3. Sync allocated_amount when budget_allocations are linked/updated
--    Recalculates SUM of original_amount for all allocations referencing this Sub-ARO
CREATE OR REPLACE FUNCTION procurements.sync_sub_aro_allocated_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_sub_aro_id UUID;
  v_total      NUMERIC;
BEGIN
  -- Determine which sub_aro_id(s) to update
  v_sub_aro_id := COALESCE(NEW.sub_aro_id, OLD.sub_aro_id);

  IF v_sub_aro_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Recalculate
  SELECT COALESCE(SUM(original_amount), 0)
    INTO v_total
    FROM procurements.budget_allocations
   WHERE sub_aro_id = v_sub_aro_id
     AND deleted_at IS NULL;

  UPDATE procurements.sub_allotment_release_orders
     SET allocated_amount = v_total,
         status = CASE
           WHEN v_total >= total_amount AND total_amount > 0 THEN 'fully_allocated'
           WHEN status = 'fully_allocated' AND v_total < total_amount THEN 'active'
           ELSE status
         END,
         updated_at = NOW()
   WHERE id = v_sub_aro_id;

  -- Also handle the case where sub_aro_id changed (old sub-aro needs recalc too)
  IF TG_OP = 'UPDATE' AND OLD.sub_aro_id IS DISTINCT FROM NEW.sub_aro_id AND OLD.sub_aro_id IS NOT NULL THEN
    SELECT COALESCE(SUM(original_amount), 0)
      INTO v_total
      FROM procurements.budget_allocations
     WHERE sub_aro_id = OLD.sub_aro_id
       AND deleted_at IS NULL;

    UPDATE procurements.sub_allotment_release_orders
       SET allocated_amount = v_total,
           status = CASE
             WHEN v_total >= total_amount AND total_amount > 0 THEN 'fully_allocated'
             WHEN status = 'fully_allocated' AND v_total < total_amount THEN 'active'
             ELSE status
           END,
           updated_at = NOW()
     WHERE id = OLD.sub_aro_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_budget_alloc_sync_sub_aro
  AFTER INSERT OR UPDATE OF sub_aro_id, original_amount, deleted_at OR DELETE
  ON procurements.budget_allocations
  FOR EACH ROW
  EXECUTE FUNCTION procurements.sync_sub_aro_allocated_amount();

-- ============================================================
-- RLS Policies
-- ============================================================

-- All division members can view Sub-AROs
CREATE POLICY "division_read_sub_aros" ON procurements.sub_allotment_release_orders
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- Budget officers can create Sub-AROs
CREATE POLICY "create_sub_aro" ON procurements.sub_allotment_release_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('budget.create')
      OR procurements.has_permission('budget.certify')
    )
    AND procurements.is_division_active()
  );

-- Budget officers can update Sub-AROs
CREATE POLICY "update_sub_aro" ON procurements.sub_allotment_release_orders
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      procurements.has_permission('budget.create')
      OR procurements.has_permission('budget.certify')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );
