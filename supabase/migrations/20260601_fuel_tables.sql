-- Fuel Request & Inventory Module — Table Definitions + Triggers
-- Tables: fuel_types, fuel_inventory, fuel_stock_movements, fuel_requests

-- ============================================================
-- procurements.fuel_types
-- Reference table for fuel categories tracked by the division.
-- Divisions can add types like Gasoline, Diesel, Premium, etc.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.fuel_types (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id     UUID          NOT NULL REFERENCES platform.divisions(id),
  name            TEXT          NOT NULL,
  unit            TEXT          NOT NULL DEFAULT 'liters',
  price_per_unit  NUMERIC(10,2),
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by      UUID          REFERENCES auth.users(id),
  UNIQUE (division_id, name)
);

CREATE INDEX idx_fuel_types_division_id ON procurements.fuel_types(division_id);
CREATE INDEX idx_fuel_types_deleted_at  ON procurements.fuel_types(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_fuel_types_active      ON procurements.fuel_types(is_active) WHERE is_active = true;

-- ============================================================
-- procurements.fuel_inventory
-- Per-office fuel stock tracking. One record per fuel type per
-- office. current_liters is updated by RPC functions when stock
-- movements occur.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.fuel_inventory (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id     UUID            NOT NULL REFERENCES platform.divisions(id),
  fuel_type_id    UUID            NOT NULL REFERENCES procurements.fuel_types(id),
  office_id       UUID            NOT NULL REFERENCES procurements.offices(id),
  current_liters  NUMERIC(12,4)   NOT NULL DEFAULT 0
                    CHECK (current_liters >= 0),
  reorder_point   NUMERIC(12,4)   NOT NULL DEFAULT 0,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  created_by      UUID            REFERENCES auth.users(id),
  UNIQUE (fuel_type_id, office_id)
);

CREATE INDEX idx_fuel_inventory_division_id  ON procurements.fuel_inventory(division_id);
CREATE INDEX idx_fuel_inventory_fuel_type_id ON procurements.fuel_inventory(fuel_type_id);
CREATE INDEX idx_fuel_inventory_office_id    ON procurements.fuel_inventory(office_id);
CREATE INDEX idx_fuel_inventory_deleted_at   ON procurements.fuel_inventory(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.fuel_stock_movements
-- Immutable ledger of all fuel stock movements. No updated_at
-- or deleted_at — corrections are new adjustment entries
-- (accounting ledger principle).
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.fuel_stock_movements (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id       UUID            NOT NULL REFERENCES platform.divisions(id),
  fuel_inventory_id UUID            NOT NULL REFERENCES procurements.fuel_inventory(id),
  movement_type     TEXT            NOT NULL
                      CHECK (movement_type IN (
                        'stock_in', 'stock_out', 'adjustment'
                      )),
  quantity_liters   NUMERIC(12,4)   NOT NULL,
  reference_type    TEXT,
  reference_id      UUID,
  remarks           TEXT,
  office_id         UUID            REFERENCES procurements.offices(id),
  created_by        UUID            REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fuel_stock_movements_division_id       ON procurements.fuel_stock_movements(division_id);
CREATE INDEX idx_fuel_stock_movements_fuel_inventory_id ON procurements.fuel_stock_movements(fuel_inventory_id);
CREATE INDEX idx_fuel_stock_movements_type              ON procurements.fuel_stock_movements(movement_type);
CREATE INDEX idx_fuel_stock_movements_reference         ON procurements.fuel_stock_movements(reference_type, reference_id);
CREATE INDEX idx_fuel_stock_movements_created_at        ON procurements.fuel_stock_movements(created_at DESC);

-- ============================================================
-- procurements.fuel_requests
-- Trip Ticket requests for fuel. Philippine government standard
-- form fields for vehicle trips with fuel allocation.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.fuel_requests (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id           UUID          NOT NULL REFERENCES platform.divisions(id),
  request_number        TEXT          NOT NULL,
  office_id             UUID          NOT NULL REFERENCES procurements.offices(id),
  requested_by          UUID          NOT NULL REFERENCES auth.users(id),
  fuel_type_id          UUID          NOT NULL REFERENCES procurements.fuel_types(id),

  -- Trip Ticket fields (Philippine government standard form)
  date_of_trip          DATE          NOT NULL,
  destination           TEXT          NOT NULL,
  purpose               TEXT          NOT NULL,

  -- Vehicle details
  vehicle_type          TEXT          NOT NULL,
  vehicle_plate_number  TEXT          NOT NULL,

  -- Passengers / authorized riders
  passengers            JSONB         NOT NULL DEFAULT '[]',

  -- Departure and arrival (filled post-trip for tracking)
  departure_time        TIMESTAMPTZ,
  arrival_time_at_dest  TIMESTAMPTZ,
  departure_from_dest   TIMESTAMPTZ,
  arrival_time_return   TIMESTAMPTZ,

  -- Odometer readings
  km_departure          NUMERIC(10,2),
  km_arrival            NUMERIC(10,2),
  distance_traveled_km  NUMERIC(10,2),

  -- Fuel
  liters_requested      NUMERIC(12,4) NOT NULL CHECK (liters_requested > 0),
  liters_approved       NUMERIC(12,4),

  -- Approver fields
  approver_remarks      TEXT,

  -- Workflow
  status                TEXT          NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending', 'approved', 'rejected',
                            'cancelled', 'dispensed'
                          )),
  approved_by           UUID          REFERENCES auth.users(id),
  approved_at           TIMESTAMPTZ,
  rejected_by           UUID          REFERENCES auth.users(id),
  rejected_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  cancelled_by          UUID          REFERENCES auth.users(id),
  cancelled_at          TIMESTAMPTZ,
  dispensed_at          TIMESTAMPTZ,

  -- Soft delete / audit
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by            UUID          REFERENCES auth.users(id),

  UNIQUE (division_id, request_number)
);

CREATE INDEX idx_fuel_requests_division_id   ON procurements.fuel_requests(division_id);
CREATE INDEX idx_fuel_requests_office_id     ON procurements.fuel_requests(office_id);
CREATE INDEX idx_fuel_requests_requested_by  ON procurements.fuel_requests(requested_by);
CREATE INDEX idx_fuel_requests_status        ON procurements.fuel_requests(status);
CREATE INDEX idx_fuel_requests_fuel_type_id  ON procurements.fuel_requests(fuel_type_id);
CREATE INDEX idx_fuel_requests_deleted_at    ON procurements.fuel_requests(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- Enable RLS on all new tables
-- ============================================================
ALTER TABLE procurements.fuel_types           ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.fuel_inventory       ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.fuel_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.fuel_requests        ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- 1. updated_at triggers (reuse existing set_updated_at function)
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER trg_fuel_types_updated_at
  BEFORE UPDATE ON procurements.fuel_types
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_fuel_inventory_updated_at
  BEFORE UPDATE ON procurements.fuel_inventory
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_fuel_requests_updated_at
  BEFORE UPDATE ON procurements.fuel_requests
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- (No updated_at trigger for fuel_stock_movements — immutable ledger)

-- ────────────────────────────────────────────────────────────
-- 2. Audit triggers
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER trg_audit_fuel_types
  AFTER INSERT OR UPDATE OR DELETE ON procurements.fuel_types
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_audit_fuel_inventory
  AFTER INSERT OR UPDATE OR DELETE ON procurements.fuel_inventory
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_audit_fuel_stock_movements
  AFTER INSERT ON procurements.fuel_stock_movements
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_audit_fuel_requests
  AFTER INSERT OR UPDATE OR DELETE ON procurements.fuel_requests
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();
