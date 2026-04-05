-- Phase 7: Procurement Core — Table Definitions
-- Tables: suppliers, purchase_requests, pr_items, obligation_requests

-- ============================================================
-- procurements.suppliers
-- Per-division supplier registry. TIN is unique within a division.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.suppliers (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id      UUID          NOT NULL REFERENCES platform.divisions(id),
  name             TEXT          NOT NULL,
  trade_name       TEXT,
  tin              TEXT          NOT NULL,
  philgeps_number  TEXT,
  address          TEXT,
  city             TEXT,
  province         TEXT,
  zip_code         TEXT,
  contact_person   TEXT,
  contact_number   TEXT,
  email            TEXT,
  website          TEXT,
  business_type    TEXT,
  classification   TEXT[]        NOT NULL DEFAULT '{}',
  status           TEXT          NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'blacklisted', 'suspended', 'inactive')),
  blacklist_reason TEXT,
  blacklist_date   DATE,
  blacklist_until  DATE,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by       UUID          REFERENCES auth.users(id),
  UNIQUE (division_id, tin)
);

CREATE INDEX idx_suppliers_division_id ON procurements.suppliers(division_id);
CREATE INDEX idx_suppliers_status      ON procurements.suppliers(status);
CREATE INDEX idx_suppliers_deleted_at  ON procurements.suppliers(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.purchase_requests
-- One PR per APP item / lot reference.
-- ppmp_item_id → ppmp_lots(id): the source lot from the PPMP
-- app_item_id  → app_items(id): the corresponding APP row
-- lot_id       → app_lots(id):  the BAC-assigned Lot
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.purchase_requests (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id            UUID          NOT NULL REFERENCES platform.divisions(id),
  pr_number              TEXT          NOT NULL,
  office_id              UUID          NOT NULL REFERENCES procurements.offices(id),
  fiscal_year_id         UUID          NOT NULL REFERENCES procurements.fiscal_years(id),
  purpose                TEXT          NOT NULL,
  requested_by           UUID          NOT NULL REFERENCES auth.users(id),
  requested_at           TIMESTAMPTZ,
  fund_source_id         UUID          REFERENCES procurements.fund_sources(id),
  budget_allocation_id   UUID          REFERENCES procurements.budget_allocations(id),
  ppmp_item_id           UUID          REFERENCES procurements.ppmp_lots(id),
  app_item_id            UUID          REFERENCES procurements.app_items(id),
  lot_id                 UUID          REFERENCES procurements.app_lots(id),
  total_estimated_cost   NUMERIC(15,2) NOT NULL DEFAULT 0,
  status                 TEXT          NOT NULL DEFAULT 'draft'
                           CHECK (status IN (
                             'draft', 'submitted', 'budget_certified',
                             'approved', 'in_procurement', 'completed', 'cancelled'
                           )),
  budget_certified_by    UUID          REFERENCES auth.users(id),
  budget_certified_at    TIMESTAMPTZ,
  approved_by            UUID          REFERENCES auth.users(id),
  approved_at            TIMESTAMPTZ,
  cancellation_reason    TEXT,
  cancelled_by           UUID          REFERENCES auth.users(id),
  cancelled_at           TIMESTAMPTZ,
  deleted_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by             UUID          REFERENCES auth.users(id),
  UNIQUE (division_id, pr_number)
);

CREATE INDEX idx_prs_division_id   ON procurements.purchase_requests(division_id);
CREATE INDEX idx_prs_office_id     ON procurements.purchase_requests(office_id);
CREATE INDEX idx_prs_status        ON procurements.purchase_requests(status);
CREATE INDEX idx_prs_app_item_id   ON procurements.purchase_requests(app_item_id);
CREATE INDEX idx_prs_lot_id        ON procurements.purchase_requests(lot_id);
CREATE INDEX idx_prs_fiscal_year   ON procurements.purchase_requests(fiscal_year_id);
CREATE INDEX idx_prs_created_by    ON procurements.purchase_requests(created_by);
CREATE INDEX idx_prs_deleted_at    ON procurements.purchase_requests(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.pr_items
-- Line items within a PR.
-- estimated_total_cost is GENERATED from quantity × estimated_unit_cost.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.pr_items (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id   UUID            NOT NULL REFERENCES procurements.purchase_requests(id) ON DELETE CASCADE,
  item_number           INTEGER         NOT NULL,
  description           TEXT            NOT NULL,
  unit                  TEXT            NOT NULL,
  quantity              NUMERIC(12,4)   NOT NULL,
  estimated_unit_cost   NUMERIC(15,2)   NOT NULL,
  estimated_total_cost  NUMERIC(15,2)   GENERATED ALWAYS AS (quantity * estimated_unit_cost) STORED,
  ppmp_item_id          UUID            REFERENCES procurements.ppmp_lots(id),
  app_item_id           UUID            REFERENCES procurements.app_items(id),
  remarks               TEXT,
  office_id             UUID            REFERENCES procurements.offices(id),
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pr_items_pr_id      ON procurements.pr_items(purchase_request_id);
CREATE INDEX idx_pr_items_deleted_at ON procurements.pr_items(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.obligation_requests
-- OBR created when Budget Officer certifies a PR.
-- procurement_id is NULL here; FK will be added in Phase 8.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.obligation_requests (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id          UUID          NOT NULL REFERENCES platform.divisions(id),
  obr_number           TEXT          NOT NULL,
  purchase_request_id  UUID          NOT NULL REFERENCES procurements.purchase_requests(id),
  procurement_id       UUID,
  budget_allocation_id UUID          REFERENCES procurements.budget_allocations(id),
  office_id            UUID          REFERENCES procurements.offices(id),
  amount               NUMERIC(15,2) NOT NULL,
  status               TEXT          NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'certified', 'obligated', 'cancelled')),
  certified_by         UUID          REFERENCES auth.users(id),
  certified_at         TIMESTAMPTZ,
  obligated_at         TIMESTAMPTZ,
  remarks              TEXT,
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by           UUID          REFERENCES auth.users(id),
  UNIQUE (division_id, obr_number)
);

CREATE INDEX idx_obrs_division_id ON procurements.obligation_requests(division_id);
CREATE INDEX idx_obrs_pr_id       ON procurements.obligation_requests(purchase_request_id);
CREATE INDEX idx_obrs_status      ON procurements.obligation_requests(status);
CREATE INDEX idx_obrs_deleted_at  ON procurements.obligation_requests(deleted_at) WHERE deleted_at IS NULL;

-- Enable RLS on all new tables
ALTER TABLE procurements.suppliers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.purchase_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.pr_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.obligation_requests ENABLE ROW LEVEL SECURITY;
