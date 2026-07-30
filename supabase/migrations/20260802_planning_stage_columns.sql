-- ============================================================
-- planning_stage: derived from the budget ceiling a version was
-- prepared against, NOT from approval status.
--
-- The old indicative_final columns are left in place but deprecated;
-- Task 4 stops writing them and the UI cuts over in Task 6.
-- ============================================================

ALTER TABLE procurements.ppmp_versions
  ADD COLUMN IF NOT EXISTS planning_stage TEXT
    CHECK (planning_stage IS NULL
           OR planning_stage IN ('indicative','final','supplemental')),
  ADD COLUMN IF NOT EXISTS budget_ceiling_id UUID
    REFERENCES procurements.budget_ceilings(id);

ALTER TABLE procurements.app_versions
  ADD COLUMN IF NOT EXISTS planning_stage TEXT
    CHECK (planning_stage IS NULL
           OR planning_stage IN ('indicative','final','supplemental')),
  ADD COLUMN IF NOT EXISTS budget_ceiling_id UUID
    REFERENCES procurements.budget_ceilings(id);

COMMENT ON COLUMN procurements.ppmp_versions.planning_stage IS
  'Derived from budget_ceiling_id at insert. Never written by an approval action.';
COMMENT ON COLUMN procurements.app_versions.planning_stage IS
  'Derived from budget_ceiling_id at insert. Never written by an approval action.';

COMMENT ON COLUMN procurements.ppmp_versions.indicative_final IS
  'DEPRECATED: was written from approval status, which inverted the real sequence. Use planning_stage.';
COMMENT ON COLUMN procurements.app_versions.indicative_final IS
  'DEPRECATED: was written from approval status. Use planning_stage.';
COMMENT ON COLUMN procurements.ppmps.indicative_final IS
  'DEPRECATED: redundant with ppmp_versions.planning_stage.';
COMMENT ON COLUMN procurements.apps.indicative_final IS
  'DEPRECATED: redundant with app_versions.planning_stage.';

CREATE INDEX IF NOT EXISTS idx_ppmp_versions_ceiling ON procurements.ppmp_versions(budget_ceiling_id);
CREATE INDEX IF NOT EXISTS idx_app_versions_ceiling  ON procurements.app_versions(budget_ceiling_id);
CREATE INDEX IF NOT EXISTS idx_ppmp_versions_stage   ON procurements.ppmp_versions(planning_stage);
CREATE INDEX IF NOT EXISTS idx_app_versions_stage    ON procurements.app_versions(planning_stage);

-- ============================================================
-- Set planning_stage on insert from the FY's authoritative ceiling.
-- Also blocks post-hoc changes: a version's stage is a historical
-- fact about the money it was planned against.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.set_version_planning_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_fiscal_year_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- planning_stage and budget_ceiling_id are immutable once set
    IF OLD.planning_stage IS NOT NULL
       AND NEW.planning_stage IS DISTINCT FROM OLD.planning_stage THEN
      RAISE EXCEPTION
        'planning_stage is immutable (version %). It is derived from the budget ceiling, not from workflow status.',
        OLD.version_number;
    END IF;
    IF OLD.budget_ceiling_id IS NOT NULL
       AND NEW.budget_ceiling_id IS DISTINCT FROM OLD.budget_ceiling_id THEN
      RAISE EXCEPTION
        'budget_ceiling_id is immutable (version %). Create a new version instead.',
        OLD.version_number;
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT: resolve the fiscal year from the parent document
  IF TG_TABLE_NAME = 'ppmp_versions' THEN
    SELECT fiscal_year_id INTO v_fiscal_year_id
      FROM procurements.ppmps WHERE id = NEW.ppmp_id;
  ELSE
    SELECT fiscal_year_id INTO v_fiscal_year_id
      FROM procurements.apps WHERE id = NEW.app_id;
  END IF;

  IF NEW.budget_ceiling_id IS NULL THEN
    NEW.budget_ceiling_id := procurements.authoritative_ceiling_id(v_fiscal_year_id);
  END IF;

  IF NEW.planning_stage IS NULL THEN
    NEW.planning_stage := COALESCE(
      (SELECT procurements.ceiling_stage_to_planning_stage(stage)
         FROM procurements.budget_ceilings
        WHERE id = NEW.budget_ceiling_id),
      procurements.fiscal_year_planning_stage(v_fiscal_year_id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ppmp_version_planning_stage ON procurements.ppmp_versions;
CREATE TRIGGER trg_ppmp_version_planning_stage
  BEFORE INSERT OR UPDATE ON procurements.ppmp_versions
  FOR EACH ROW EXECUTE FUNCTION procurements.set_version_planning_stage();

DROP TRIGGER IF EXISTS trg_app_version_planning_stage ON procurements.app_versions;
CREATE TRIGGER trg_app_version_planning_stage
  BEFORE INSERT OR UPDATE ON procurements.app_versions
  FOR EACH ROW EXECUTE FUNCTION procurements.set_version_planning_stage();

-- ============================================================
-- The authoritative ceiling that was in force at a given moment. Used only by
-- the one-time backfill: a version's stage must reflect the ceiling that
-- existed when it was created, not today's ceiling.
-- Ceilings with no issued_date are excluded — they cannot be placed in time,
-- and assuming they applied retroactively is what produced the mislabeling
-- this migration removes.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.ceiling_id_as_of(
  p_fiscal_year_id UUID,
  p_as_of          TIMESTAMPTZ
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
     AND issued_date IS NOT NULL
     AND issued_date <= p_as_of::DATE
   ORDER BY CASE stage
              WHEN 'final'      THEN 4
              WHEN 'gaa'        THEN 3
              WHEN 'nep'        THEN 2
              WHEN 'indicative' THEN 1
            END DESC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION procurements.ceiling_id_as_of(UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- Backfill existing rows.
--
-- Each version is stamped with the ceiling that was in force when the version
-- was created, not the fiscal year's current ceiling. Versions created before
-- any dated ceiling — and versions in fiscal years with no dated ceiling at
-- all — fall back to 'indicative', which is the correct conservative answer:
-- no appropriation can be proven to have existed for them.
--
-- The pre-existing indicative_final column is deliberately ignored. It was
-- written from approval status, so it carries no reliable signal about which
-- budget the plan was actually prepared against.
-- ============================================================

UPDATE procurements.ppmp_versions pv
   SET budget_ceiling_id = procurements.ceiling_id_as_of(p.fiscal_year_id, pv.created_at),
       planning_stage    = COALESCE(
         (SELECT procurements.ceiling_stage_to_planning_stage(bc.stage)
            FROM procurements.budget_ceilings bc
           WHERE bc.id = procurements.ceiling_id_as_of(p.fiscal_year_id, pv.created_at)),
         'indicative'
       )
  FROM procurements.ppmps p
 WHERE p.id = pv.ppmp_id
   AND pv.planning_stage IS NULL;

UPDATE procurements.app_versions av
   SET budget_ceiling_id = procurements.ceiling_id_as_of(a.fiscal_year_id, av.created_at),
       planning_stage    = COALESCE(
         (SELECT procurements.ceiling_stage_to_planning_stage(bc.stage)
            FROM procurements.budget_ceilings bc
           WHERE bc.id = procurements.ceiling_id_as_of(a.fiscal_year_id, av.created_at)),
         'indicative'
       )
  FROM procurements.apps a
 WHERE a.id = av.app_id
   AND av.planning_stage IS NULL;
