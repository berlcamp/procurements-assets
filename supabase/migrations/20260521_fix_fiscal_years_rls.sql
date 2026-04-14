-- Fix fiscal_years RLS policy to use division.settings permission
-- instead of fiscal_years.manage which may not be seeded.
-- The page already guards with division.settings, so align RLS to match.

BEGIN;

-- Drop existing manage policy
DROP POLICY IF EXISTS "division_manage_fiscal_years" ON procurements.fiscal_years;

-- Recreate with division.settings permission (consistent with UI guard)
CREATE POLICY "division_manage_fiscal_years" ON procurements.fiscal_years
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('division.settings')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('division.settings')
      OR platform.is_super_admin()
    )
    AND procurements.is_division_active()
  );

COMMIT;
