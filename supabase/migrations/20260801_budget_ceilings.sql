-- ============================================================
-- Budget ceilings: the missing anchor for procurement planning.
--
-- A ceiling is the budget authority a plan is prepared against.
-- The real chain for a Schools Division Office is:
--   DBM National Budget Call
--     -> DepEd Central Office budget call
--       -> Regional Office indicative ceiling   (stage = 'indicative')
--         -> NEP submitted to Congress          (stage = 'nep')
--           -> GAA enacted                      (stage = 'gaa')
--             -> comprehensive release / Sub-ARO (stage = 'final')
--               -> SARO for special purposes     (stage = 'supplemental')
--
-- planning_stage on PPMP/APP versions is DERIVED from this table.
-- It must never be written from a workflow/approval action.
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.budget_ceilings (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id        UUID          NOT NULL REFERENCES platform.divisions(id),
  fiscal_year_id     UUID          NOT NULL REFERENCES procurements.fiscal_years(id),

  stage              TEXT          NOT NULL
                       CHECK (stage IN ('indicative','nep','gaa','final','supplemental')),
  -- DBM two-tier budgeting: Tier 1 = ongoing programs, Tier 2 = new/expanded
  tier               TEXT
                       CHECK (tier IS NULL OR tier IN ('tier_1','tier_2')),

  issuing_authority  TEXT          NOT NULL DEFAULT 'DepEd Regional Office',
  reference_number   TEXT,
  amount             NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  issued_date        DATE,
  effective_date     DATE,

  -- Exactly one ceiling per (fiscal year, stage) is the operative one.
  is_authoritative   BOOLEAN       NOT NULL DEFAULT true,

  document_url       TEXT,
  remarks            TEXT,
  created_by         UUID          REFERENCES auth.users(id),
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.budget_ceilings IS
  'Budget authority a procurement plan is prepared against. Drives planning_stage on PPMP/APP versions.';
COMMENT ON COLUMN procurements.budget_ceilings.stage IS
  'Legal basis: indicative/nep = no appropriation yet; gaa/final = enacted; supplemental = SARO or additional release.';

CREATE INDEX idx_ceilings_division     ON procurements.budget_ceilings(division_id);
CREATE INDEX idx_ceilings_fiscal_year  ON procurements.budget_ceilings(fiscal_year_id);
CREATE INDEX idx_ceilings_stage        ON procurements.budget_ceilings(stage);
CREATE INDEX idx_ceilings_deleted_at   ON procurements.budget_ceilings(deleted_at) WHERE deleted_at IS NULL;

-- One authoritative ceiling per fiscal year per stage.
CREATE UNIQUE INDEX idx_ceilings_one_authoritative_per_stage
  ON procurements.budget_ceilings (fiscal_year_id, stage)
  WHERE is_authoritative = true AND deleted_at IS NULL;

CREATE TRIGGER trg_ceilings_updated_at
  BEFORE UPDATE ON procurements.budget_ceilings
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_ceilings_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.budget_ceilings
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- Stage resolution helpers
-- ============================================================

-- Returns the id of the highest-precedence authoritative ceiling for a FY.
-- Precedence: final > gaa > nep > indicative. 'supplemental' is deliberately
-- excluded — a supplemental release does not change the FY's base stage.
CREATE OR REPLACE FUNCTION procurements.authoritative_ceiling_id(
  p_fiscal_year_id UUID
)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT id
    FROM procurements.budget_ceilings
   WHERE fiscal_year_id   = p_fiscal_year_id
     AND is_authoritative = true
     AND deleted_at       IS NULL
     AND stage IN ('indicative','nep','gaa','final')
   ORDER BY CASE stage
              WHEN 'final'      THEN 4
              WHEN 'gaa'        THEN 3
              WHEN 'nep'        THEN 2
              WHEN 'indicative' THEN 1
            END DESC
   LIMIT 1;
$$;

-- Maps a ceiling stage to a planning stage.
CREATE OR REPLACE FUNCTION procurements.ceiling_stage_to_planning_stage(
  p_ceiling_stage TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_ceiling_stage
           WHEN 'indicative'   THEN 'indicative'
           WHEN 'nep'          THEN 'indicative'
           WHEN 'gaa'          THEN 'final'
           WHEN 'final'        THEN 'final'
           WHEN 'supplemental' THEN 'supplemental'
         END;
$$;

-- The FY's current planning stage. Defaults to 'indicative' when no ceiling
-- has been recorded yet, so pre-existing data keeps working.
CREATE OR REPLACE FUNCTION procurements.fiscal_year_planning_stage(
  p_fiscal_year_id UUID
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
  SELECT COALESCE(
    (SELECT procurements.ceiling_stage_to_planning_stage(bc.stage)
       FROM procurements.budget_ceilings bc
      WHERE bc.id = procurements.authoritative_ceiling_id(p_fiscal_year_id)),
    'indicative'
  );
$$;

GRANT EXECUTE ON FUNCTION procurements.authoritative_ceiling_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.ceiling_stage_to_planning_stage(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION procurements.fiscal_year_planning_stage(UUID) TO authenticated;

-- ============================================================
-- Permissions
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('budget.ceilings_view',   'budget', 'View budget ceilings',                    'division'),
  ('budget.ceilings_manage', 'budget', 'Record and manage DBM/GAA budget ceilings','division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'budget_officer'
  AND p.code IN ('budget.ceilings_view','budget.ceilings_manage')
ON CONFLICT DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name = 'division_admin'
  AND p.code IN ('budget.ceilings_view','budget.ceilings_manage')
ON CONFLICT DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('hope','division_chief','auditor','bac_chair','bac_secretariat')
  AND p.code IN ('budget.ceilings_view')
ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE procurements.budget_ceilings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "division_read_ceilings" ON procurements.budget_ceilings
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

CREATE POLICY "manage_ceilings" ON procurements.budget_ceilings
  FOR ALL TO authenticated
  USING (
    platform.is_super_admin()
    OR (
      division_id = procurements.get_user_division_id()
      AND procurements.has_permission('budget.ceilings_manage')
    )
  )
  WITH CHECK (
    platform.is_super_admin()
    OR (
      division_id = procurements.get_user_division_id()
      AND procurements.has_permission('budget.ceilings_manage')
      AND procurements.is_division_active()
    )
  );
