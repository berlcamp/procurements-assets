-- Phase 11: Purchase Orders & Delivery — Table Definitions + Triggers
-- Tables: purchase_orders, po_items, deliveries, delivery_items

-- ============================================================
-- procurements.purchase_orders
-- Created from an awarded procurement activity. One PO per procurement.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.purchase_orders (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id       UUID          NOT NULL REFERENCES platform.divisions(id),
  po_number         TEXT          NOT NULL,
  procurement_id    UUID          NOT NULL REFERENCES procurements.procurement_activities(id),
  supplier_id       UUID          NOT NULL REFERENCES procurements.suppliers(id),
  office_id         UUID          NOT NULL REFERENCES procurements.offices(id),
  fiscal_year_id    UUID          NOT NULL REFERENCES procurements.fiscal_years(id),
  total_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  delivery_date     DATE,
  delivery_address  TEXT,
  payment_terms     TEXT,
  status            TEXT          NOT NULL DEFAULT 'draft'
                      CHECK (status IN (
                        'draft', 'approved', 'issued',
                        'partially_delivered', 'fully_delivered',
                        'completed', 'cancelled'
                      )),
  approved_by       UUID          REFERENCES auth.users(id),
  approved_at       TIMESTAMPTZ,
  issued_at         TIMESTAMPTZ,
  cancellation_reason TEXT,
  cancelled_by      UUID          REFERENCES auth.users(id),
  cancelled_at      TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by        UUID          REFERENCES auth.users(id),
  UNIQUE (division_id, po_number)
);

CREATE INDEX idx_pos_division_id    ON procurements.purchase_orders(division_id);
CREATE INDEX idx_pos_procurement_id ON procurements.purchase_orders(procurement_id);
CREATE INDEX idx_pos_supplier_id    ON procurements.purchase_orders(supplier_id);
CREATE INDEX idx_pos_office_id      ON procurements.purchase_orders(office_id);
CREATE INDEX idx_pos_fiscal_year    ON procurements.purchase_orders(fiscal_year_id);
CREATE INDEX idx_pos_status         ON procurements.purchase_orders(status);
CREATE INDEX idx_pos_deleted_at     ON procurements.purchase_orders(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.po_items
-- Line items within a PO. Linked to PR items and optionally bid items.
-- total_cost is GENERATED from quantity * unit_cost.
-- delivered_quantity / accepted_quantity updated by delivery triggers.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.po_items (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id   UUID            NOT NULL REFERENCES procurements.purchase_orders(id) ON DELETE CASCADE,
  pr_item_id          UUID            REFERENCES procurements.pr_items(id),
  bid_item_id         UUID            REFERENCES procurements.bid_items(id),
  description         TEXT            NOT NULL,
  unit                TEXT            NOT NULL,
  quantity            NUMERIC(12,4)   NOT NULL,
  unit_cost           NUMERIC(15,2)   NOT NULL,
  total_cost          NUMERIC(15,2)   GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  delivered_quantity   NUMERIC(12,4)  NOT NULL DEFAULT 0,
  accepted_quantity    NUMERIC(12,4)  NOT NULL DEFAULT 0,
  remarks             TEXT,
  office_id           UUID            REFERENCES procurements.offices(id),
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_po_items_po_id       ON procurements.po_items(purchase_order_id);
CREATE INDEX idx_po_items_pr_item_id  ON procurements.po_items(pr_item_id);

-- ============================================================
-- procurements.deliveries
-- Delivery records against a PO. Supports partial deliveries.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.deliveries (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id              UUID        NOT NULL REFERENCES platform.divisions(id),
  purchase_order_id        UUID        NOT NULL REFERENCES procurements.purchase_orders(id),
  delivery_number          TEXT        NOT NULL,
  delivery_date            DATE        NOT NULL,
  received_by              UUID        REFERENCES auth.users(id),
  inspection_date          DATE,
  inspected_by             UUID        REFERENCES auth.users(id),
  inspection_status        TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (inspection_status IN (
                               'pending', 'passed', 'failed', 'partial_acceptance'
                             )),
  inspection_report_number TEXT,
  remarks                  TEXT,
  office_id                UUID        REFERENCES procurements.offices(id),
  deleted_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID        REFERENCES auth.users(id),
  UNIQUE (division_id, delivery_number)
);

CREATE INDEX idx_deliveries_division_id ON procurements.deliveries(division_id);
CREATE INDEX idx_deliveries_po_id       ON procurements.deliveries(purchase_order_id);
CREATE INDEX idx_deliveries_status      ON procurements.deliveries(inspection_status);
CREATE INDEX idx_deliveries_deleted_at  ON procurements.deliveries(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.delivery_items
-- Per-item delivery quantities with inspection acceptance/rejection.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.delivery_items (
  id                 UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id        UUID            NOT NULL REFERENCES procurements.deliveries(id) ON DELETE CASCADE,
  po_item_id         UUID            NOT NULL REFERENCES procurements.po_items(id),
  quantity_delivered  NUMERIC(12,4)   NOT NULL,
  quantity_accepted   NUMERIC(12,4)   NOT NULL DEFAULT 0,
  quantity_rejected   NUMERIC(12,4)   NOT NULL DEFAULT 0,
  rejection_reason    TEXT,
  remarks             TEXT,
  office_id           UUID            REFERENCES procurements.offices(id),
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_delivery_items_delivery_id ON procurements.delivery_items(delivery_id);
CREATE INDEX idx_delivery_items_po_item_id  ON procurements.delivery_items(po_item_id);

-- ============================================================
-- Enable RLS on all new tables
-- ============================================================
ALTER TABLE procurements.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.po_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.deliveries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.delivery_items  ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- 1. updated_at triggers (reuse existing set_updated_at function)
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER trg_purchase_orders_updated_at
  BEFORE UPDATE ON procurements.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_po_items_updated_at
  BEFORE UPDATE ON procurements.po_items
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_deliveries_updated_at
  BEFORE UPDATE ON procurements.deliveries
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_delivery_items_updated_at
  BEFORE UPDATE ON procurements.delivery_items
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. Delivery items → PO items quantity sync
--
-- When delivery_items are inserted or updated, aggregate
-- delivered/accepted quantities to the parent po_item.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION procurements.sync_delivery_to_po_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_po_item_id UUID;
BEGIN
  -- Determine which po_item_id to update
  v_po_item_id := COALESCE(NEW.po_item_id, OLD.po_item_id);

  -- Aggregate all delivery_items for this po_item across non-deleted deliveries
  UPDATE procurements.po_items
     SET delivered_quantity = COALESCE(sub.total_delivered, 0),
         accepted_quantity  = COALESCE(sub.total_accepted, 0),
         updated_at         = NOW()
    FROM (
      SELECT SUM(di.quantity_delivered) AS total_delivered,
             SUM(di.quantity_accepted)  AS total_accepted
        FROM procurements.delivery_items di
        JOIN procurements.deliveries d ON d.id = di.delivery_id
       WHERE di.po_item_id = v_po_item_id
         AND d.deleted_at IS NULL
    ) sub
   WHERE procurements.po_items.id = v_po_item_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_delivery_items_sync_to_po
  AFTER INSERT OR UPDATE OR DELETE ON procurements.delivery_items
  FOR EACH ROW
  EXECUTE FUNCTION procurements.sync_delivery_to_po_items();

-- ────────────────────────────────────────────────────────────
-- 3. PO items → PO delivery status sync
--
-- When po_items.delivered_quantity changes, check if PO
-- should transition to partially_delivered or fully_delivered.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION procurements.sync_po_delivery_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_po_id           UUID;
  v_po_status       TEXT;
  v_total_items     INTEGER;
  v_fully_delivered  INTEGER;
  v_any_delivered    BOOLEAN;
BEGIN
  -- Get the parent PO
  SELECT purchase_order_id INTO v_po_id
    FROM procurements.po_items
   WHERE id = NEW.id;

  -- Only act on issued or partially_delivered POs
  SELECT status INTO v_po_status
    FROM procurements.purchase_orders
   WHERE id = v_po_id;

  IF v_po_status NOT IN ('issued', 'partially_delivered') THEN
    RETURN NEW;
  END IF;

  -- Count items and delivery progress
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE delivered_quantity >= quantity),
         BOOL_OR(delivered_quantity > 0)
    INTO v_total_items, v_fully_delivered, v_any_delivered
    FROM procurements.po_items
   WHERE purchase_order_id = v_po_id;

  -- Update PO status
  IF v_fully_delivered = v_total_items AND v_total_items > 0 THEN
    UPDATE procurements.purchase_orders
       SET status = 'fully_delivered', updated_at = NOW()
     WHERE id = v_po_id;
  ELSIF v_any_delivered THEN
    UPDATE procurements.purchase_orders
       SET status = 'partially_delivered', updated_at = NOW()
     WHERE id = v_po_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_po_items_delivery_status
  AFTER UPDATE OF delivered_quantity ON procurements.po_items
  FOR EACH ROW
  WHEN (OLD.delivered_quantity IS DISTINCT FROM NEW.delivered_quantity)
  EXECUTE FUNCTION procurements.sync_po_delivery_status();

-- ────────────────────────────────────────────────────────────
-- 4. PO approval → OBR obligation trigger
--
-- When a PO is approved, find the linked OBR (via procurement →
-- purchase_request → obligation_request) and set it to 'obligated'.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION procurements.obligate_on_po_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_pr_id UUID;
BEGIN
  -- Only fire on transition to 'approved'
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Find the PR linked to this PO's procurement
  SELECT pa.purchase_request_id INTO v_pr_id
    FROM procurements.procurement_activities pa
   WHERE pa.id = NEW.procurement_id;

  IF v_pr_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Set linked OBR to 'obligated'
  UPDATE procurements.obligation_requests
     SET status      = 'obligated',
         obligated_at = NOW(),
         updated_at   = NOW()
   WHERE purchase_request_id = v_pr_id
     AND status = 'certified'
     AND deleted_at IS NULL;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_po_approval_obligate
  AFTER UPDATE OF status ON procurements.purchase_orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION procurements.obligate_on_po_approval();

-- ────────────────────────────────────────────────────────────
-- 5. Audit triggers on purchase_orders and deliveries
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER trg_audit_purchase_orders
  AFTER INSERT OR UPDATE OR DELETE ON procurements.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_audit_deliveries
  AFTER INSERT OR UPDATE OR DELETE ON procurements.deliveries
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();
