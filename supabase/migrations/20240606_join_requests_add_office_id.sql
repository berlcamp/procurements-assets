-- Add office_id to division_join_requests so users can select their office/school during onboarding
ALTER TABLE procurements.division_join_requests
  ADD COLUMN IF NOT EXISTS office_id UUID REFERENCES procurements.offices(id);

CREATE INDEX IF NOT EXISTS idx_join_requests_office
  ON procurements.division_join_requests(office_id);
