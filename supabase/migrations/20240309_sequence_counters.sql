-- Phase 3: sequence_counters table
CREATE TABLE IF NOT EXISTS procurements.sequence_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES platform.divisions(id),
  office_id UUID REFERENCES procurements.offices(id),
  counter_type TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  prefix TEXT,
  UNIQUE (division_id, office_id, counter_type, fiscal_year)
);

CREATE INDEX idx_seq_counters_division ON procurements.sequence_counters(division_id);
CREATE INDEX idx_seq_counters_type ON procurements.sequence_counters(counter_type);
