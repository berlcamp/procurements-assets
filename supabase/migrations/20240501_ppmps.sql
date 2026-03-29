-- Phase 5: PPMP core tables (ppmps, ppmp_versions, ppmp_items)

-- ============================================================
-- procurements.ppmps
-- One PPMP per office per fiscal year.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.ppmps (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id               UUID          NOT NULL REFERENCES platform.divisions(id),
  office_id                 UUID          NOT NULL REFERENCES procurements.offices(id),
  fiscal_year_id            UUID          NOT NULL REFERENCES procurements.fiscal_years(id),
  current_version           INTEGER       NOT NULL DEFAULT 1,
  status                    TEXT          NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','submitted','chief_reviewed','budget_certified','approved','revision_required','locked')),
  indicative_final          TEXT          NOT NULL DEFAULT 'indicative'
                              CHECK (indicative_final IN ('indicative','final')),
  submitted_at              TIMESTAMPTZ,
  submitted_by              UUID          REFERENCES auth.users(id),
  chief_reviewed_by         UUID          REFERENCES auth.users(id),
  chief_reviewed_at         TIMESTAMPTZ,
  chief_review_notes        TEXT,
  budget_certified_by       UUID          REFERENCES auth.users(id),
  budget_certified_at       TIMESTAMPTZ,
  budget_certification_notes TEXT,
  approved_by               UUID          REFERENCES auth.users(id),
  approved_at               TIMESTAMPTZ,
  approval_notes            TEXT,
  deleted_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by                UUID          REFERENCES auth.users(id),
  UNIQUE (office_id, fiscal_year_id)
);

CREATE INDEX idx_ppmps_division_id     ON procurements.ppmps(division_id);
CREATE INDEX idx_ppmps_office_id       ON procurements.ppmps(office_id);
CREATE INDEX idx_ppmps_fiscal_year_id  ON procurements.ppmps(fiscal_year_id);
CREATE INDEX idx_ppmps_created_by      ON procurements.ppmps(created_by);
CREATE INDEX idx_ppmps_deleted_at      ON procurements.ppmps(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.ppmp_versions
-- Tracks each version (original, amendment, supplemental).
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.ppmp_versions (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ppmp_id                 UUID          NOT NULL REFERENCES procurements.ppmps(id) ON DELETE CASCADE,
  version_number          INTEGER       NOT NULL DEFAULT 1,
  version_type            TEXT          NOT NULL DEFAULT 'original'
                            CHECK (version_type IN ('original','amendment','supplemental')),
  amendment_justification TEXT,
  total_estimated_cost    NUMERIC(15,2) NOT NULL DEFAULT 0,
  snapshot_data           JSONB,
  status                  TEXT          NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','submitted','chief_reviewed','budget_certified','approved','superseded')),
  indicative_final        TEXT          NOT NULL DEFAULT 'indicative'
                            CHECK (indicative_final IN ('indicative','final')),
  approved_by             UUID          REFERENCES auth.users(id),
  approved_at             TIMESTAMPTZ,
  office_id               UUID          NOT NULL REFERENCES procurements.offices(id),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by              UUID          REFERENCES auth.users(id),
  UNIQUE (ppmp_id, version_number)
);

CREATE INDEX idx_ppmp_versions_ppmp_id    ON procurements.ppmp_versions(ppmp_id);
CREATE INDEX idx_ppmp_versions_office_id  ON procurements.ppmp_versions(office_id);
CREATE INDEX idx_ppmp_versions_created_by ON procurements.ppmp_versions(created_by);

-- ============================================================
-- procurements.ppmp_items
-- Individual line items within a PPMP version.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.ppmp_items (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  ppmp_version_id       UUID            NOT NULL REFERENCES procurements.ppmp_versions(id) ON DELETE CASCADE,
  ppmp_id               UUID            NOT NULL REFERENCES procurements.ppmps(id),
  item_number           INTEGER         NOT NULL,
  category              TEXT            NOT NULL
                          CHECK (category IN ('common_use_supplies','non_common_supplies','equipment','services','infrastructure')),
  description           TEXT            NOT NULL,
  unit                  TEXT            NOT NULL,
  quantity              NUMERIC(15,4)   NOT NULL CHECK (quantity > 0),
  estimated_unit_cost   NUMERIC(15,2)   NOT NULL CHECK (estimated_unit_cost >= 0),
  estimated_total_cost  NUMERIC(15,2)   GENERATED ALWAYS AS (quantity * estimated_unit_cost) STORED,
  procurement_method    TEXT            NOT NULL DEFAULT 'shopping',
  budget_allocation_id  UUID            REFERENCES procurements.budget_allocations(id),
  schedule_q1           NUMERIC(15,4)   NOT NULL DEFAULT 0,
  schedule_q2           NUMERIC(15,4)   NOT NULL DEFAULT 0,
  schedule_q3           NUMERIC(15,4)   NOT NULL DEFAULT 0,
  schedule_q4           NUMERIC(15,4)   NOT NULL DEFAULT 0,
  is_cse                BOOLEAN         NOT NULL DEFAULT false,
  remarks               TEXT,
  office_id             UUID            NOT NULL REFERENCES procurements.offices(id),
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_by            UUID            REFERENCES auth.users(id)
);

-- Q1+Q2+Q3+Q4 must equal quantity (rounded to avoid floating-point drift)
ALTER TABLE procurements.ppmp_items
  ADD CONSTRAINT chk_ppmp_items_schedule_sum
    CHECK (ROUND(schedule_q1 + schedule_q2 + schedule_q3 + schedule_q4, 4) = ROUND(quantity, 4));

CREATE INDEX idx_ppmp_items_ppmp_version_id     ON procurements.ppmp_items(ppmp_version_id);
CREATE INDEX idx_ppmp_items_ppmp_id             ON procurements.ppmp_items(ppmp_id);
CREATE INDEX idx_ppmp_items_office_id           ON procurements.ppmp_items(office_id);
CREATE INDEX idx_ppmp_items_budget_alloc_id     ON procurements.ppmp_items(budget_allocation_id);
CREATE INDEX idx_ppmp_items_created_by          ON procurements.ppmp_items(created_by);
CREATE INDEX idx_ppmp_items_deleted_at          ON procurements.ppmp_items(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- updated_at triggers
-- ============================================================

CREATE TRIGGER trg_ppmps_updated_at
  BEFORE UPDATE ON procurements.ppmps
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_ppmp_items_updated_at
  BEFORE UPDATE ON procurements.ppmp_items
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- ============================================================
-- Audit triggers
-- ============================================================

CREATE TRIGGER trg_ppmps_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.ppmps
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_ppmp_versions_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.ppmp_versions
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_ppmp_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.ppmp_items
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- Enable RLS (policies defined in 20240502_ppmp_rls.sql)
-- ============================================================

ALTER TABLE procurements.ppmps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.ppmp_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.ppmp_items     ENABLE ROW LEVEL SECURITY;
