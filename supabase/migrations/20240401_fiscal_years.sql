-- Phase 4: fiscal_years table
-- One active fiscal year per division at a time (enforced by trigger).

CREATE TABLE IF NOT EXISTS procurements.fiscal_years (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID        NOT NULL REFERENCES platform.divisions(id),
  year        INTEGER     NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT false,
  start_date  DATE,
  end_date    DATE,
  status      TEXT        NOT NULL DEFAULT 'planning'
                CHECK (status IN ('planning', 'open', 'closing', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, year)
);

CREATE INDEX idx_fiscal_years_division   ON procurements.fiscal_years(division_id);
CREATE INDEX idx_fiscal_years_active     ON procurements.fiscal_years(division_id) WHERE is_active = true;
CREATE INDEX idx_fiscal_years_status     ON procurements.fiscal_years(status);

-- ============================================================
-- updated_at trigger
-- ============================================================

CREATE TRIGGER trg_fiscal_years_updated_at
  BEFORE UPDATE ON procurements.fiscal_years
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

-- ============================================================
-- Enforce single active fiscal year per division
-- When a fiscal year is set active, deactivate all others in
-- the same division automatically.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.enforce_single_active_fiscal_year()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE procurements.fiscal_years
    SET    is_active = false,
           status    = CASE WHEN status = 'open' THEN 'closing' ELSE status END,
           updated_at = NOW()
    WHERE  division_id = NEW.division_id
      AND  id         != NEW.id
      AND  is_active   = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_single_active_fiscal_year
  BEFORE INSERT OR UPDATE OF is_active ON procurements.fiscal_years
  FOR EACH ROW
  WHEN (NEW.is_active = true)
  EXECUTE FUNCTION procurements.enforce_single_active_fiscal_year();

-- ============================================================
-- Audit trigger
-- ============================================================

CREATE TRIGGER trg_fiscal_years_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.fiscal_years
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE procurements.fiscal_years ENABLE ROW LEVEL SECURITY;

-- All division members can read their division's fiscal years
CREATE POLICY "division_read_fiscal_years" ON procurements.fiscal_years
  FOR SELECT TO authenticated
  USING (division_id = procurements.get_user_division_id());

-- Division Admin manages fiscal years within their division
CREATE POLICY "division_manage_fiscal_years" ON procurements.fiscal_years
  FOR ALL TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('fiscal_years.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('fiscal_years.manage')
    AND procurements.is_division_active()
  );
