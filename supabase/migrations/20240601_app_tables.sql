-- Phase 6: APP (Annual Procurement Plan) core tables
-- Structure: apps -> app_versions -> app_items, app_lots (BAC grouping)
-- One APP per division per fiscal year.

-- ============================================================
-- procurements.apps
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.apps (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id         UUID          NOT NULL REFERENCES platform.divisions(id),
  fiscal_year_id      UUID          NOT NULL REFERENCES procurements.fiscal_years(id),
  current_version     INTEGER       NOT NULL DEFAULT 1,
  status              TEXT          NOT NULL DEFAULT 'populating'
                        CHECK (status IN ('populating','indicative','under_review','bac_finalization','final','approved','posted')),
  indicative_final    TEXT          NOT NULL DEFAULT 'indicative'
                        CHECK (indicative_final IN ('indicative','final')),
  philgeps_reference  TEXT,
  approved_by         UUID          REFERENCES auth.users(id),
  approved_at         TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by          UUID          REFERENCES auth.users(id),
  UNIQUE (division_id, fiscal_year_id)
);

CREATE INDEX idx_apps_division_id    ON procurements.apps(division_id);
CREATE INDEX idx_apps_fiscal_year_id ON procurements.apps(fiscal_year_id);
CREATE INDEX idx_apps_deleted_at     ON procurements.apps(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.app_versions
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.app_versions (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                  UUID          NOT NULL REFERENCES procurements.apps(id) ON DELETE CASCADE,
  version_number          INTEGER       NOT NULL,
  version_type            TEXT          NOT NULL DEFAULT 'original'
                            CHECK (version_type IN ('original','amendment','supplemental')),
  amendment_justification TEXT,
  total_estimated_cost    NUMERIC(15,2) NOT NULL DEFAULT 0,
  snapshot_data           JSONB,
  status                  TEXT          NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','under_review','bac_finalization','final','approved','superseded')),
  indicative_final        TEXT          NOT NULL DEFAULT 'indicative'
                            CHECK (indicative_final IN ('indicative','final')),
  approved_by             UUID          REFERENCES auth.users(id),
  approved_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by              UUID          REFERENCES auth.users(id),
  UNIQUE (app_id, version_number)
);

CREATE INDEX idx_app_versions_app_id ON procurements.app_versions(app_id);

-- ============================================================
-- procurements.app_items
-- Each row is a PPMP lot auto-populated from approved PPMPs.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.app_items (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  app_version_id          UUID          NOT NULL REFERENCES procurements.app_versions(id) ON DELETE CASCADE,
  app_id                  UUID          NOT NULL REFERENCES procurements.apps(id),
  source_ppmp_project_id  UUID          REFERENCES procurements.ppmp_projects(id),
  source_ppmp_lot_id      UUID          REFERENCES procurements.ppmp_lots(id),
  source_ppmp_id          UUID          REFERENCES procurements.ppmps(id),
  item_number             INTEGER       NOT NULL,
  general_description     TEXT          NOT NULL,
  project_type            TEXT,
  procurement_mode        TEXT,
  estimated_budget        NUMERIC(15,2) NOT NULL DEFAULT 0,
  source_of_funds         TEXT,
  procurement_start       TEXT,
  procurement_end         TEXT,
  delivery_period         TEXT,
  budget_allocation_id    UUID          REFERENCES procurements.budget_allocations(id),
  source_office_id        UUID          REFERENCES procurements.offices(id),
  hope_review_status      TEXT          NOT NULL DEFAULT 'pending'
                            CHECK (hope_review_status IN ('pending','approved','remarked')),
  hope_reviewed_by        UUID          REFERENCES auth.users(id),
  hope_reviewed_at        TIMESTAMPTZ,
  hope_remarks            TEXT,
  lot_id                  UUID,  -- FK added after app_lots table is created
  lot_item_number         INTEGER,
  remarks                 TEXT,
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by              UUID          REFERENCES auth.users(id)
);

CREATE INDEX idx_app_items_version_id      ON procurements.app_items(app_version_id);
CREATE INDEX idx_app_items_app_id          ON procurements.app_items(app_id);
CREATE INDEX idx_app_items_source_ppmp_id  ON procurements.app_items(source_ppmp_id);
CREATE INDEX idx_app_items_lot_id          ON procurements.app_items(lot_id);
CREATE INDEX idx_app_items_review_status   ON procurements.app_items(hope_review_status);
CREATE INDEX idx_app_items_deleted_at      ON procurements.app_items(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.app_lots
-- BAC groups approved APP items into procurement lots.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.app_lots (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                UUID          NOT NULL REFERENCES procurements.apps(id),
  app_version_id        UUID          NOT NULL REFERENCES procurements.app_versions(id) ON DELETE CASCADE,
  lot_number            INTEGER       NOT NULL,
  lot_name              TEXT          NOT NULL,
  description           TEXT,
  procurement_method    TEXT,
  total_estimated_cost  NUMERIC(15,2) NOT NULL DEFAULT 0,
  status                TEXT          NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','finalized','in_procurement')),
  finalized_by          UUID          REFERENCES auth.users(id),
  finalized_at          TIMESTAMPTZ,
  division_id           UUID          NOT NULL REFERENCES platform.divisions(id),
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by            UUID          REFERENCES auth.users(id),
  UNIQUE (app_version_id, lot_number)
);

CREATE INDEX idx_app_lots_app_id      ON procurements.app_lots(app_id);
CREATE INDEX idx_app_lots_version_id  ON procurements.app_lots(app_version_id);
CREATE INDEX idx_app_lots_deleted_at  ON procurements.app_lots(deleted_at) WHERE deleted_at IS NULL;

-- Now add the FK from app_items.lot_id -> app_lots(id)
ALTER TABLE procurements.app_items
  ADD CONSTRAINT fk_app_items_lot_id
  FOREIGN KEY (lot_id) REFERENCES procurements.app_lots(id);

-- Enable RLS on all tables
ALTER TABLE procurements.apps        ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.app_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.app_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.app_lots    ENABLE ROW LEVEL SECURITY;
