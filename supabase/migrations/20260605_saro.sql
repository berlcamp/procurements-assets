-- Special Allotment Release Order (SARO) tracking
-- Models fund authority from DBM for special-purpose funds (calamity, GASTPE, SBM grants, etc.)

-- ============================================================
-- procurements.special_allotment_release_orders
-- Tracks SAROs received by the Division from DBM.
-- Budget allocations reference this as their funding authority.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.special_allotment_release_orders (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id       UUID          NOT NULL REFERENCES platform.divisions(id),
  fiscal_year_id    UUID          NOT NULL REFERENCES procurements.fiscal_years(id),

  -- SARO identifiers
  saro_number       TEXT          NOT NULL,
  reference_number  TEXT,                      -- DBM control/reference number (optional)

  -- Classification
  allotment_class   TEXT          NOT NULL DEFAULT 'current'
                      CHECK (allotment_class IN ('current', 'continuing')),
  fund_source_id    UUID          NOT NULL REFERENCES procurements.fund_sources(id),
  program           TEXT,                      -- Special program/project name (e.g. "Calamity Fund", "GASTPE", "SBM Grant")

  -- Authority details
  releasing_office  TEXT,                      -- e.g. "Department of Budget and Management"
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
  document_url      TEXT,                      -- Storage path for the signed SARO PDF

  -- Audit
  remarks           TEXT,
  created_by        UUID          REFERENCES auth.users(id),
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (division_id, saro_number)
);

CREATE INDEX idx_saros_division_id     ON procurements.special_allotment_release_orders(division_id);
CREATE INDEX idx_saros_fiscal_year     ON procurements.special_allotment_release_orders(fiscal_year_id);
CREATE INDEX idx_saros_fund_source     ON procurements.special_allotment_release_orders(fund_source_id);
CREATE INDEX idx_saros_status          ON procurements.special_allotment_release_orders(status);
CREATE INDEX idx_saros_allotment_class ON procurements.special_allotment_release_orders(allotment_class);
CREATE INDEX idx_saros_deleted_at      ON procurements.special_allotment_release_orders(deleted_at) WHERE deleted_at IS NULL;

ALTER TABLE procurements.special_allotment_release_orders ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Add saro_id FK to budget_allocations
-- ============================================================
ALTER TABLE procurements.budget_allocations
  ADD COLUMN saro_id UUID REFERENCES procurements.special_allotment_release_orders(id);

CREATE INDEX idx_budget_alloc_saro ON procurements.budget_allocations(saro_id);

-- An allocation can link to at most one funding authority (Sub-ARO or SARO, not both)
ALTER TABLE procurements.budget_allocations
  ADD CONSTRAINT chk_single_funding_authority
  CHECK (NOT (sub_aro_id IS NOT NULL AND saro_id IS NOT NULL));

-- ============================================================
-- Triggers
-- ============================================================

-- 1. updated_at
CREATE TRIGGER trg_saros_updated_at
  BEFORE UPDATE ON procurements.special_allotment_release_orders
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- 2. Audit
CREATE TRIGGER trg_audit_saros
  AFTER INSERT OR UPDATE OR DELETE ON procurements.special_allotment_release_orders
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- 3. Sync allocated_amount when budget_allocations are linked/updated
--    Recalculates SUM of original_amount for all allocations referencing this SARO
CREATE OR REPLACE FUNCTION procurements.sync_saro_allocated_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_saro_id UUID;
  v_total   NUMERIC;
BEGIN
  -- Determine which saro_id(s) to update
  v_saro_id := COALESCE(NEW.saro_id, OLD.saro_id);

  IF v_saro_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Recalculate
  SELECT COALESCE(SUM(original_amount), 0)
    INTO v_total
    FROM procurements.budget_allocations
   WHERE saro_id = v_saro_id
     AND deleted_at IS NULL;

  UPDATE procurements.special_allotment_release_orders
     SET allocated_amount = v_total,
         status = CASE
           WHEN v_total >= total_amount AND total_amount > 0 THEN 'fully_allocated'
           WHEN status = 'fully_allocated' AND v_total < total_amount THEN 'active'
           ELSE status
         END,
         updated_at = NOW()
   WHERE id = v_saro_id;

  -- Also handle the case where saro_id changed (old SARO needs recalc too)
  IF TG_OP = 'UPDATE' AND OLD.saro_id IS DISTINCT FROM NEW.saro_id AND OLD.saro_id IS NOT NULL THEN
    SELECT COALESCE(SUM(original_amount), 0)
      INTO v_total
      FROM procurements.budget_allocations
     WHERE saro_id = OLD.saro_id
       AND deleted_at IS NULL;

    UPDATE procurements.special_allotment_release_orders
       SET allocated_amount = v_total,
           status = CASE
             WHEN v_total >= total_amount AND total_amount > 0 THEN 'fully_allocated'
             WHEN status = 'fully_allocated' AND v_total < total_amount THEN 'active'
             ELSE status
           END,
           updated_at = NOW()
     WHERE id = OLD.saro_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_budget_alloc_sync_saro
  AFTER INSERT OR UPDATE OF saro_id, original_amount, deleted_at OR DELETE
  ON procurements.budget_allocations
  FOR EACH ROW
  EXECUTE FUNCTION procurements.sync_saro_allocated_amount();

-- ============================================================
-- RLS Policies
-- ============================================================

-- All division members can view SAROs
CREATE POLICY "division_read_saros" ON procurements.special_allotment_release_orders
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- Budget officers can create SAROs
CREATE POLICY "create_saro" ON procurements.special_allotment_release_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('budget.create')
      OR procurements.has_permission('budget.certify')
    )
    AND procurements.is_division_active()
  );

-- Budget officers can update SAROs
CREATE POLICY "update_saro" ON procurements.special_allotment_release_orders
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
