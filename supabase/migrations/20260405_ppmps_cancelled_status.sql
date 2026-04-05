-- Add 'cancelled' as a valid PPMP status.
-- A cancelled PPMP preserves the audit trail but is excluded from active lists.
-- The unique constraint on (office_id, fiscal_year_id) is relaxed so a new PPMP
-- can be created for the same office + fiscal year after one is cancelled.

-- 1. Widen the CHECK constraint to include 'cancelled'
ALTER TABLE procurements.ppmps
  DROP CONSTRAINT IF EXISTS ppmps_status_check;

ALTER TABLE procurements.ppmps
  ADD CONSTRAINT ppmps_status_check
    CHECK (status IN (
      'draft','submitted','chief_reviewed','budget_certified',
      'approved','revision_required','locked','cancelled'
    ));

-- 2. Replace the hard unique constraint with a partial unique index
--    so cancelled PPMPs do not block re-creation for the same office + FY.
ALTER TABLE procurements.ppmps
  DROP CONSTRAINT IF EXISTS ppmps_office_id_fiscal_year_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS ppmps_office_fiscal_year_active_unique
  ON procurements.ppmps (office_id, fiscal_year_id)
  WHERE status <> 'cancelled';

-- 3. Allow the end_user_update_ppmp RLS policy to also cover
--    cancellation (status update from 'draft' → 'cancelled').
--    The existing policy already allows updates where created_by = auth.uid()
--    AND status = 'draft', which covers this transition.
--    No policy change needed.
