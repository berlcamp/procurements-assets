-- Phase 8: Procurement Workflows (SVP + Shopping) — Table Definitions
-- Tables: procurement_activities, procurement_stages, bids, bid_items
-- Also adds procurement_id FK on existing obligation_requests
-- and adds procurement_id column on purchase_requests

-- ============================================================
-- procurements.procurement_activities
-- Main procurement activity record. One per approved PR.
-- procurement_method accommodates all future phases (9, 10).
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.procurement_activities (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id          UUID          NOT NULL REFERENCES platform.divisions(id),
  procurement_number   TEXT          NOT NULL,
  office_id            UUID          NOT NULL REFERENCES procurements.offices(id),
  fiscal_year_id       UUID          NOT NULL REFERENCES procurements.fiscal_years(id),
  purchase_request_id  UUID          NOT NULL REFERENCES procurements.purchase_requests(id),
  procurement_method   TEXT          NOT NULL
                         CHECK (procurement_method IN (
                           'svp', 'shopping', 'competitive_bidding',
                           'direct_contracting', 'repeat_order',
                           'emergency', 'negotiated', 'agency_to_agency'
                         )),
  abc_amount           NUMERIC(15,2) NOT NULL,
  current_stage        TEXT          NOT NULL DEFAULT 'created',
  awarded_supplier_id  UUID          REFERENCES procurements.suppliers(id),
  contract_amount      NUMERIC(15,2),
  savings_amount       NUMERIC(15,2) GENERATED ALWAYS AS (
                         abc_amount - COALESCE(contract_amount, abc_amount)
                       ) STORED,
  failure_reason       TEXT,
  failure_count        INTEGER       NOT NULL DEFAULT 0,
  philgeps_reference   TEXT,
  status               TEXT          NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'completed', 'failed', 'cancelled')),
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by           UUID          REFERENCES auth.users(id),
  UNIQUE (division_id, procurement_number)
);

CREATE INDEX idx_proc_act_division_id   ON procurements.procurement_activities(division_id);
CREATE INDEX idx_proc_act_office_id     ON procurements.procurement_activities(office_id);
CREATE INDEX idx_proc_act_pr_id         ON procurements.procurement_activities(purchase_request_id);
CREATE INDEX idx_proc_act_method        ON procurements.procurement_activities(procurement_method);
CREATE INDEX idx_proc_act_stage         ON procurements.procurement_activities(current_stage);
CREATE INDEX idx_proc_act_status        ON procurements.procurement_activities(status);
CREATE INDEX idx_proc_act_fiscal_year   ON procurements.procurement_activities(fiscal_year_id);
CREATE INDEX idx_proc_act_deleted_at    ON procurements.procurement_activities(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.procurement_stages
-- Audit trail of stage transitions. Each row is one stage visit.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.procurement_stages (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id  UUID          NOT NULL REFERENCES procurements.procurement_activities(id) ON DELETE CASCADE,
  stage           TEXT          NOT NULL,
  status          TEXT          NOT NULL DEFAULT 'current'
                    CHECK (status IN ('completed', 'current', 'skipped')),
  started_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  completed_by    UUID          REFERENCES auth.users(id),
  notes           TEXT,
  office_id       UUID          REFERENCES procurements.offices(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_proc_stages_procurement ON procurements.procurement_stages(procurement_id);
CREATE INDEX idx_proc_stages_stage       ON procurements.procurement_stages(stage);

-- ============================================================
-- procurements.bids
-- Quotations / canvass records from suppliers.
-- One bid per supplier per procurement activity.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.bids (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id          UUID          NOT NULL REFERENCES procurements.procurement_activities(id) ON DELETE CASCADE,
  supplier_id             UUID          NOT NULL REFERENCES procurements.suppliers(id),
  bid_amount              NUMERIC(15,2) NOT NULL DEFAULT 0,
  bid_date                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  is_responsive           BOOLEAN       NOT NULL DEFAULT TRUE,
  is_eligible             BOOLEAN       NOT NULL DEFAULT TRUE,
  is_compliant            BOOLEAN       NOT NULL DEFAULT TRUE,
  rank                    INTEGER,
  evaluation_score        NUMERIC(5,2),
  status                  TEXT          NOT NULL DEFAULT 'submitted'
                            CHECK (status IN ('submitted', 'evaluated', 'awarded', 'disqualified')),
  disqualification_reason TEXT,
  remarks                 TEXT,
  office_id               UUID          REFERENCES procurements.offices(id),
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (procurement_id, supplier_id)
);

CREATE INDEX idx_bids_procurement ON procurements.bids(procurement_id);
CREATE INDEX idx_bids_supplier    ON procurements.bids(supplier_id);
CREATE INDEX idx_bids_status      ON procurements.bids(status);
CREATE INDEX idx_bids_deleted_at  ON procurements.bids(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- procurements.bid_items
-- Line-item pricing per bid. References pr_items for traceability.
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.bid_items (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id            UUID          NOT NULL REFERENCES procurements.bids(id) ON DELETE CASCADE,
  pr_item_id        UUID          NOT NULL REFERENCES procurements.pr_items(id),
  offered_unit_cost NUMERIC(15,2) NOT NULL,
  offered_total_cost NUMERIC(15,2) NOT NULL,
  brand_model       TEXT,
  specifications    TEXT,
  remarks           TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bid_items_bid ON procurements.bid_items(bid_id);
CREATE INDEX idx_bid_items_pr_item ON procurements.bid_items(pr_item_id);

-- ============================================================
-- Add procurement_id column to purchase_requests
-- (obligation_requests already has it from Phase 7)
-- ============================================================
ALTER TABLE procurements.purchase_requests
  ADD COLUMN IF NOT EXISTS procurement_id UUID;

-- ============================================================
-- Add FK constraints linking to procurement_activities
-- ============================================================
ALTER TABLE procurements.purchase_requests
  ADD CONSTRAINT fk_pr_procurement_activity
  FOREIGN KEY (procurement_id) REFERENCES procurements.procurement_activities(id);

ALTER TABLE procurements.obligation_requests
  ADD CONSTRAINT fk_obr_procurement_activity
  FOREIGN KEY (procurement_id) REFERENCES procurements.procurement_activities(id);

-- ============================================================
-- Enable RLS on all new tables
-- ============================================================
ALTER TABLE procurements.procurement_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.procurement_stages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.bids                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.bid_items              ENABLE ROW LEVEL SECURITY;
