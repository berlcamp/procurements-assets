-- Phase 12: Asset Management (Inventory) — Table Definitions + Triggers
-- Tables: item_catalog, inventory, stock_movements

-- ============================================================
-- procurements.item_catalog
-- Master catalog of all items tracked by the division.
-- Shared across offices within a division. Categories determine
-- whether items become assets (PPE/semi-expendable) or consumables.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.item_catalog (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id       UUID          NOT NULL REFERENCES platform.divisions(id),
  code              TEXT          NOT NULL,
  name              TEXT          NOT NULL,
  description       TEXT,
  category          TEXT          NOT NULL
                      CHECK (category IN (
                        'consumable', 'semi_expendable', 'ppe'
                      )),
  unit              TEXT          NOT NULL,
  account_code_id   UUID          REFERENCES procurements.account_codes(id),
  useful_life_years INTEGER,
  is_active         BOOLEAN       NOT NULL DEFAULT true,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by        UUID          REFERENCES auth.users(id),
  UNIQUE (division_id, code)
);

CREATE INDEX idx_item_catalog_division_id    ON procurements.item_catalog(division_id);
CREATE INDEX idx_item_catalog_category       ON procurements.item_catalog(category);
CREATE INDEX idx_item_catalog_account_code   ON procurements.item_catalog(account_code_id);
CREATE INDEX idx_item_catalog_deleted_at     ON procurements.item_catalog(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_item_catalog_active         ON procurements.item_catalog(is_active) WHERE is_active = true;

-- ============================================================
-- procurements.inventory
-- Per-office stock tracking. One record per item per office.
-- current_quantity is updated by stock_movement triggers.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.inventory (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id         UUID            NOT NULL REFERENCES platform.divisions(id),
  item_catalog_id     UUID            NOT NULL REFERENCES procurements.item_catalog(id),
  office_id           UUID            NOT NULL REFERENCES procurements.offices(id),
  current_quantity    NUMERIC(12,4)   NOT NULL DEFAULT 0
                        CHECK (current_quantity >= 0),
  reorder_point       NUMERIC(12,4)   NOT NULL DEFAULT 0,
  location            TEXT,
  last_count_date     DATE,
  last_count_quantity NUMERIC(12,4),
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_by          UUID            REFERENCES auth.users(id),
  UNIQUE (item_catalog_id, office_id)
);

CREATE INDEX idx_inventory_division_id     ON procurements.inventory(division_id);
CREATE INDEX idx_inventory_item_catalog_id ON procurements.inventory(item_catalog_id);
CREATE INDEX idx_inventory_office_id       ON procurements.inventory(office_id);
CREATE INDEX idx_inventory_deleted_at      ON procurements.inventory(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.stock_movements
-- Immutable ledger of all stock movements. No updated_at or
-- deleted_at — corrections are new adjustment entries (accounting
-- ledger principle).
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.stock_movements (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id     UUID            NOT NULL REFERENCES platform.divisions(id),
  inventory_id    UUID            NOT NULL REFERENCES procurements.inventory(id),
  movement_type   TEXT            NOT NULL
                    CHECK (movement_type IN (
                      'stock_in', 'stock_out', 'adjustment',
                      'transfer_in', 'transfer_out', 'return'
                    )),
  quantity        NUMERIC(12,4)   NOT NULL,
  reference_type  TEXT,
  reference_id    UUID,
  remarks         TEXT,
  office_id       UUID            REFERENCES procurements.offices(id),
  created_by      UUID            REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_movements_division_id   ON procurements.stock_movements(division_id);
CREATE INDEX idx_stock_movements_inventory_id  ON procurements.stock_movements(inventory_id);
CREATE INDEX idx_stock_movements_type          ON procurements.stock_movements(movement_type);
CREATE INDEX idx_stock_movements_reference     ON procurements.stock_movements(reference_type, reference_id);
CREATE INDEX idx_stock_movements_created_at    ON procurements.stock_movements(created_at DESC);

-- ============================================================
-- Enable RLS on all new tables
-- ============================================================
ALTER TABLE procurements.item_catalog    ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.inventory       ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.stock_movements ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- 1. updated_at triggers (reuse existing set_updated_at function)
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER trg_item_catalog_updated_at
  BEFORE UPDATE ON procurements.item_catalog
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON procurements.inventory
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- (No updated_at trigger for stock_movements — immutable ledger)

-- ────────────────────────────────────────────────────────────
-- 2. Audit triggers
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER trg_audit_item_catalog
  AFTER INSERT OR UPDATE OR DELETE ON procurements.item_catalog
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_audit_inventory
  AFTER INSERT OR UPDATE OR DELETE ON procurements.inventory
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_audit_stock_movements
  AFTER INSERT ON procurements.stock_movements
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();
