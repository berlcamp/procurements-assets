-- Phase 14: Request System — Table Definitions + Triggers
-- Tables: requests, request_items

-- ============================================================
-- procurements.requests
-- Supply, equipment, service, and procurement requests.
-- Flows through supervisor approval then fulfillment (stock
-- issuance or routing to procurement via PR creation).
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.requests (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id            UUID          NOT NULL REFERENCES platform.divisions(id),
  request_number         TEXT          NOT NULL,
  request_type           TEXT          NOT NULL
                           CHECK (request_type IN (
                             'supply', 'equipment', 'service', 'procurement'
                           )),
  office_id              UUID          NOT NULL REFERENCES procurements.offices(id),
  requested_by           UUID          NOT NULL REFERENCES auth.users(id),
  purpose                TEXT          NOT NULL,
  urgency                TEXT          NOT NULL DEFAULT 'normal'
                           CHECK (urgency IN (
                             'low', 'normal', 'high', 'emergency'
                           )),
  status                 TEXT          NOT NULL DEFAULT 'draft'
                           CHECK (status IN (
                             'draft', 'submitted', 'supervisor_approved',
                             'processing', 'partially_fulfilled', 'fulfilled',
                             'rejected', 'cancelled'
                           )),
  supervisor_id          UUID          REFERENCES auth.users(id),
  supervisor_approved_at TIMESTAMPTZ,
  supervisor_remarks     TEXT,
  processed_by           UUID          REFERENCES auth.users(id),
  processed_at           TIMESTAMPTZ,
  fulfillment_type       TEXT
                           CHECK (fulfillment_type IS NULL OR fulfillment_type IN (
                             'stock', 'procurement', 'mixed'
                           )),
  linked_pr_id           UUID          REFERENCES procurements.purchase_requests(id),
  rejection_reason       TEXT,
  rejected_by            UUID          REFERENCES auth.users(id),
  rejected_at            TIMESTAMPTZ,
  cancelled_by           UUID          REFERENCES auth.users(id),
  cancelled_at           TIMESTAMPTZ,
  deleted_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by             UUID          REFERENCES auth.users(id),
  UNIQUE (division_id, request_number)
);

CREATE INDEX idx_requests_division_id   ON procurements.requests(division_id);
CREATE INDEX idx_requests_office_id     ON procurements.requests(office_id);
CREATE INDEX idx_requests_requested_by  ON procurements.requests(requested_by);
CREATE INDEX idx_requests_status        ON procurements.requests(status);
CREATE INDEX idx_requests_request_type  ON procurements.requests(request_type);
CREATE INDEX idx_requests_supervisor_id ON procurements.requests(supervisor_id);
CREATE INDEX idx_requests_linked_pr_id  ON procurements.requests(linked_pr_id)
  WHERE linked_pr_id IS NOT NULL;
CREATE INDEX idx_requests_deleted_at    ON procurements.requests(deleted_at)
  WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.request_items
-- Line items for each request. item_catalog_id is nullable for
-- service requests (free-text description). inventory_id is
-- set by the supply officer during fulfillment.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.request_items (
  id                 UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         UUID            NOT NULL REFERENCES procurements.requests(id) ON DELETE CASCADE,
  item_catalog_id    UUID            REFERENCES procurements.item_catalog(id),
  description        TEXT            NOT NULL,
  unit               TEXT            NOT NULL,
  quantity_requested NUMERIC(12,4)   NOT NULL CHECK (quantity_requested > 0),
  quantity_issued    NUMERIC(12,4)   NOT NULL DEFAULT 0 CHECK (quantity_issued >= 0),
  item_number        INTEGER         NOT NULL,
  inventory_id       UUID            REFERENCES procurements.inventory(id),
  remarks            TEXT,
  office_id          UUID            REFERENCES procurements.offices(id),
  created_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_request_items_request_id      ON procurements.request_items(request_id);
CREATE INDEX idx_request_items_item_catalog_id ON procurements.request_items(item_catalog_id)
  WHERE item_catalog_id IS NOT NULL;
CREATE INDEX idx_request_items_inventory_id    ON procurements.request_items(inventory_id)
  WHERE inventory_id IS NOT NULL;

-- ============================================================
-- Enable RLS on all new tables
-- ============================================================
ALTER TABLE procurements.requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.request_items ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- 1. updated_at triggers (reuse existing set_updated_at function)
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER trg_requests_updated_at
  BEFORE UPDATE ON procurements.requests
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_request_items_updated_at
  BEFORE UPDATE ON procurements.request_items
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- ──────────────────────────────��─────────────────────────────
-- 2. Audit triggers
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER trg_audit_requests
  AFTER INSERT OR UPDATE OR DELETE ON procurements.requests
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_audit_request_items
  AFTER INSERT OR UPDATE OR DELETE ON procurements.request_items
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();
