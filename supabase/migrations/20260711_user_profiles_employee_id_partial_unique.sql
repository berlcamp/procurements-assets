-- Fix: employee_id uniqueness should ignore soft-deleted profiles.
--
-- The original `UNIQUE (division_id, employee_id)` constraint counts
-- soft-deleted rows (deleted_at IS NOT NULL), so re-inviting a user with an
-- employee_id previously used by a now-deleted profile fails with
-- "duplicate key value violates unique constraint
--  user_profiles_division_id_employee_id_key".
--
-- Replace it with a partial unique index that only applies to live rows and
-- non-null employee IDs.

ALTER TABLE procurements.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_division_id_employee_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_profiles_division_employee_id
  ON procurements.user_profiles (division_id, employee_id)
  WHERE deleted_at IS NULL AND employee_id IS NOT NULL;
