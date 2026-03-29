-- Phase 4: budget_allocations table
-- One allocation per office/fund_source/account_code per fiscal year.
-- All monetary amounts are NUMERIC(15,2) — never compute in JavaScript.

CREATE TABLE IF NOT EXISTS procurements.budget_allocations (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id       UUID          NOT NULL REFERENCES platform.divisions(id),
  fiscal_year_id    UUID          NOT NULL REFERENCES procurements.fiscal_years(id),
  office_id         UUID          NOT NULL REFERENCES procurements.offices(id),
  fund_source_id    UUID          NOT NULL REFERENCES procurements.fund_sources(id),
  account_code_id   UUID          NOT NULL REFERENCES procurements.account_codes(id),
  original_amount   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (original_amount >= 0),
  adjusted_amount   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (adjusted_amount >= 0),
  obligated_amount  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (obligated_amount >= 0),
  disbursed_amount  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (disbursed_amount >= 0),
  description       TEXT,
  status            TEXT          NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'inactive', 'closed')),
  created_by        UUID          REFERENCES auth.users(id),
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (fiscal_year_id, office_id, fund_source_id, account_code_id)
);

-- Obligated cannot exceed adjusted_amount
ALTER TABLE procurements.budget_allocations
  ADD CONSTRAINT chk_obligated_lte_adjusted
    CHECK (obligated_amount <= adjusted_amount);

-- Disbursed cannot exceed obligated
ALTER TABLE procurements.budget_allocations
  ADD CONSTRAINT chk_disbursed_lte_obligated
    CHECK (disbursed_amount <= obligated_amount);

CREATE INDEX idx_budget_alloc_division       ON procurements.budget_allocations(division_id);
CREATE INDEX idx_budget_alloc_fiscal_year    ON procurements.budget_allocations(fiscal_year_id);
CREATE INDEX idx_budget_alloc_office         ON procurements.budget_allocations(office_id);
CREATE INDEX idx_budget_alloc_fund_source    ON procurements.budget_allocations(fund_source_id);
CREATE INDEX idx_budget_alloc_account_code   ON procurements.budget_allocations(account_code_id);
CREATE INDEX idx_budget_alloc_deleted_at     ON procurements.budget_allocations(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- updated_at trigger
-- ============================================================

CREATE TRIGGER trg_budget_allocations_updated_at
  BEFORE UPDATE ON procurements.budget_allocations
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- ============================================================
-- Audit trigger
-- ============================================================

CREATE TRIGGER trg_budget_allocations_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.budget_allocations
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE procurements.budget_allocations ENABLE ROW LEVEL SECURITY;

-- All division members can read budget allocations in their division
CREATE POLICY "division_read_budget_allocations" ON procurements.budget_allocations
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- Budget Officer / Division Admin can create allocations
CREATE POLICY "budget_create_allocations" ON procurements.budget_allocations
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('budget_allocations.create')
      OR platform.is_super_admin()
    )
    AND procurements.is_division_active()
  );

-- Budget Officer / Division Admin can update allocations
CREATE POLICY "budget_update_allocations" ON procurements.budget_allocations
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('budget_allocations.update')
      OR platform.is_super_admin()
    )
  );

-- Soft-delete only (sets deleted_at)
CREATE POLICY "budget_delete_allocations" ON procurements.budget_allocations
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      procurements.has_permission('budget_allocations.delete')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );
