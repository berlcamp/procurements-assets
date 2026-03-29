-- Phase 5: PPMP core tables
-- Structure: ppmps → ppmp_versions → ppmp_projects → ppmp_lots → ppmp_lot_items
-- Matches GPPB PPMP Form (RA 12009 IRR)

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
  total_estimated_budget  NUMERIC(15,2) NOT NULL DEFAULT 0,
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
-- procurements.ppmp_projects
-- Each row = one procurement project in the PPMP form.
-- Maps to GPPB Columns 1-2 (description, type).
-- A project groups one or more lots.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.ppmp_projects (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ppmp_version_id       UUID          NOT NULL REFERENCES procurements.ppmp_versions(id) ON DELETE CASCADE,
  ppmp_id               UUID          NOT NULL REFERENCES procurements.ppmps(id),
  project_number        INTEGER       NOT NULL,
  -- Column 1: General Description and Objective
  general_description   TEXT          NOT NULL,
  -- Column 2: Type of Project (Goods, Infrastructure, Consulting Services)
  project_type          TEXT          NOT NULL
                          CHECK (project_type IN ('goods','infrastructure','consulting_services')),
  office_id             UUID          NOT NULL REFERENCES procurements.offices(id),
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by            UUID          REFERENCES auth.users(id)
);

CREATE INDEX idx_ppmp_projects_version_id  ON procurements.ppmp_projects(ppmp_version_id);
CREATE INDEX idx_ppmp_projects_ppmp_id     ON procurements.ppmp_projects(ppmp_id);
CREATE INDEX idx_ppmp_projects_office_id   ON procurements.ppmp_projects(office_id);
CREATE INDEX idx_ppmp_projects_deleted_at  ON procurements.ppmp_projects(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.ppmp_lots
-- Each lot = one row in the PPMP form (or the only row if no lots).
-- Maps to GPPB Columns 3-12.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.ppmp_lots (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ppmp_project_id             UUID          NOT NULL REFERENCES procurements.ppmp_projects(id) ON DELETE CASCADE,
  lot_number                  INTEGER       NOT NULL DEFAULT 1,
  lot_title                   TEXT,
  -- Column 4: Recommended Mode of Procurement
  procurement_mode            TEXT          NOT NULL DEFAULT 'competitive_bidding',
  -- Column 5: Pre-Procurement Conference
  pre_procurement_conference  BOOLEAN       NOT NULL DEFAULT false,
  -- Column 6: Start of Procurement Activity (MM/YYYY)
  procurement_start           TEXT,
  -- Column 7: End of Procurement Activity (MM/YYYY)
  procurement_end             TEXT,
  -- Column 8: Expected Delivery/Implementation Period
  delivery_period             TEXT,
  -- Column 9: Source of Funds
  source_of_funds             TEXT,
  -- Column 10: Estimated Budget / ABC
  estimated_budget            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (estimated_budget >= 0),
  -- Column 11: Attached Supporting Documents
  supporting_documents        TEXT,
  -- Column 12: Remarks
  remarks                     TEXT,
  -- Budget linkage
  budget_allocation_id        UUID          REFERENCES procurements.budget_allocations(id),
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ppmp_lots_project_id ON procurements.ppmp_lots(ppmp_project_id);
CREATE INDEX idx_ppmp_lots_budget_id  ON procurements.ppmp_lots(budget_allocation_id);

-- ============================================================
-- procurements.ppmp_lot_items
-- Individual items within a lot (Column 3: Quantity and Size).
-- Multiple items per lot.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.ppmp_lot_items (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ppmp_lot_id           UUID          NOT NULL REFERENCES procurements.ppmp_lots(id) ON DELETE CASCADE,
  item_number           INTEGER       NOT NULL DEFAULT 1,
  description           TEXT          NOT NULL,
  quantity              NUMERIC(15,4) NOT NULL CHECK (quantity > 0),
  unit                  TEXT          NOT NULL,
  specification         TEXT,
  estimated_unit_cost   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (estimated_unit_cost >= 0),
  estimated_total_cost  NUMERIC(15,2) GENERATED ALWAYS AS (quantity * estimated_unit_cost) STORED,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ppmp_lot_items_lot_id ON procurements.ppmp_lot_items(ppmp_lot_id);

-- ============================================================
-- updated_at triggers
-- ============================================================

CREATE TRIGGER trg_ppmps_updated_at
  BEFORE UPDATE ON procurements.ppmps
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_ppmp_projects_updated_at
  BEFORE UPDATE ON procurements.ppmp_projects
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_ppmp_lots_updated_at
  BEFORE UPDATE ON procurements.ppmp_lots
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_ppmp_lot_items_updated_at
  BEFORE UPDATE ON procurements.ppmp_lot_items
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

CREATE TRIGGER trg_ppmp_projects_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.ppmp_projects
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_ppmp_lots_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.ppmp_lots
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_ppmp_lot_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.ppmp_lot_items
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- Enable RLS (policies defined in 20240502_ppmp_rls.sql)
-- ============================================================

ALTER TABLE procurements.ppmps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.ppmp_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.ppmp_projects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.ppmp_lots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.ppmp_lot_items ENABLE ROW LEVEL SECURITY;
