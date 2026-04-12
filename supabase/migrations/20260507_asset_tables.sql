-- Phase 13: Asset Management (Property) — Table Definitions + Triggers
-- Tables: assets, asset_assignments, depreciation_records

-- ============================================================
-- procurements.assets
-- Core asset registry for semi-expendable and PPE items.
-- Assets are registered from accepted deliveries or manually
-- for pre-existing property. Each asset has a unique property
-- number, financial tracking, and custody chain.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.assets (
  id                       UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id              UUID            NOT NULL REFERENCES platform.divisions(id),
  property_number          TEXT            NOT NULL,
  item_catalog_id          UUID            NOT NULL REFERENCES procurements.item_catalog(id),
  office_id                UUID            NOT NULL REFERENCES procurements.offices(id),
  description              TEXT,
  brand_model              TEXT,
  serial_number            TEXT,
  acquisition_date         DATE            NOT NULL,
  acquisition_cost         NUMERIC(14,2)   NOT NULL,
  source_po_id             UUID            REFERENCES procurements.purchase_orders(id),
  source_delivery_id       UUID            REFERENCES procurements.deliveries(id),
  source_delivery_item_id  UUID            REFERENCES procurements.delivery_items(id),
  asset_type               TEXT            NOT NULL
                             CHECK (asset_type IN (
                               'semi_expendable', 'ppe'
                             )),
  condition_status         TEXT            NOT NULL DEFAULT 'serviceable'
                             CHECK (condition_status IN (
                               'serviceable', 'needs_repair',
                               'unserviceable', 'disposed'
                             )),
  current_custodian_id     UUID            REFERENCES auth.users(id),
  location                 TEXT,
  useful_life_years        INTEGER,
  residual_value           NUMERIC(14,2)   NOT NULL DEFAULT 0,
  accumulated_depreciation NUMERIC(14,2)   NOT NULL DEFAULT 0,
  book_value               NUMERIC(14,2)   NOT NULL,
  status                   TEXT            NOT NULL DEFAULT 'active'
                             CHECK (status IN (
                               'active', 'transferred', 'for_disposal',
                               'disposed', 'lost', 'donated'
                             )),
  disposal_date            DATE,
  disposal_method          TEXT,
  disposal_reference       TEXT,
  deleted_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_by               UUID            REFERENCES auth.users(id),
  UNIQUE (division_id, property_number)
);

CREATE INDEX idx_assets_division_id     ON procurements.assets(division_id);
CREATE INDEX idx_assets_office_id       ON procurements.assets(office_id);
CREATE INDEX idx_assets_item_catalog_id ON procurements.assets(item_catalog_id);
CREATE INDEX idx_assets_asset_type      ON procurements.assets(asset_type);
CREATE INDEX idx_assets_status          ON procurements.assets(status);
CREATE INDEX idx_assets_condition       ON procurements.assets(condition_status);
CREATE INDEX idx_assets_custodian_id    ON procurements.assets(current_custodian_id);
CREATE INDEX idx_assets_property_number ON procurements.assets(property_number);
CREATE INDEX idx_assets_deleted_at      ON procurements.assets(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_assets_source_delivery ON procurements.assets(source_delivery_item_id);

-- ============================================================
-- procurements.asset_assignments
-- Custody chain tracking via PAR (PPE) and ICS (semi-expendable)
-- documents. Each assignment has an auto-generated document
-- number. The is_current flag marks the active custodian.
-- division_id is denormalized for efficient RLS evaluation.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.asset_assignments (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id     UUID          NOT NULL REFERENCES platform.divisions(id),
  asset_id        UUID          NOT NULL REFERENCES procurements.assets(id),
  custodian_id    UUID          NOT NULL REFERENCES auth.users(id),
  office_id       UUID          NOT NULL REFERENCES procurements.offices(id),
  document_type   TEXT          NOT NULL
                    CHECK (document_type IN ('par', 'ics')),
  document_number TEXT          NOT NULL,
  assigned_date   DATE          NOT NULL DEFAULT CURRENT_DATE,
  returned_date   DATE,
  remarks         TEXT,
  assigned_by     UUID          REFERENCES auth.users(id),
  is_current      BOOLEAN       NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_asset_assignments_asset_id     ON procurements.asset_assignments(asset_id);
CREATE INDEX idx_asset_assignments_custodian_id ON procurements.asset_assignments(custodian_id);
CREATE INDEX idx_asset_assignments_office_id    ON procurements.asset_assignments(office_id);
CREATE INDEX idx_asset_assignments_division_id  ON procurements.asset_assignments(division_id);
CREATE INDEX idx_asset_assignments_current      ON procurements.asset_assignments(is_current) WHERE is_current = true;
CREATE INDEX idx_asset_assignments_doc_number   ON procurements.asset_assignments(document_number);

-- ============================================================
-- procurements.depreciation_records
-- Immutable ledger of monthly straight-line depreciation.
-- One record per asset per month. No updates or deletes —
-- corrections use reversal entries (accounting principle).
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.depreciation_records (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            UUID            NOT NULL REFERENCES procurements.assets(id),
  period_year         INTEGER         NOT NULL,
  period_month        INTEGER         NOT NULL
                        CHECK (period_month BETWEEN 1 AND 12),
  depreciation_amount NUMERIC(14,2)   NOT NULL,
  accumulated_amount  NUMERIC(14,2)   NOT NULL,
  book_value          NUMERIC(14,2)   NOT NULL,
  office_id           UUID            NOT NULL REFERENCES procurements.offices(id),
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (asset_id, period_year, period_month)
);

CREATE INDEX idx_depreciation_asset_id ON procurements.depreciation_records(asset_id);
CREATE INDEX idx_depreciation_period   ON procurements.depreciation_records(period_year, period_month);
CREATE INDEX idx_depreciation_office   ON procurements.depreciation_records(office_id);

-- ============================================================
-- Enable RLS on all new tables
-- ============================================================
ALTER TABLE procurements.assets               ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.asset_assignments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.depreciation_records ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- 1. updated_at triggers (reuse existing set_updated_at function)
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER trg_assets_updated_at
  BEFORE UPDATE ON procurements.assets
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_asset_assignments_updated_at
  BEFORE UPDATE ON procurements.asset_assignments
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- (No updated_at trigger for depreciation_records — immutable ledger)

-- ────────────────────────────────────────────────────────────
-- 2. Audit triggers
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER trg_audit_assets
  AFTER INSERT OR UPDATE OR DELETE ON procurements.assets
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_audit_asset_assignments
  AFTER INSERT OR UPDATE OR DELETE ON procurements.asset_assignments
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_audit_depreciation_records
  AFTER INSERT ON procurements.depreciation_records
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();
