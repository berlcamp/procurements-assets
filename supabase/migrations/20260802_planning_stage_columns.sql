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

CREATE INDEX idx_ppmp_versions_ceiling ON procurements.ppmp_versions(budget_ceiling_id);
CREATE INDEX idx_app_versions_ceiling  ON procurements.app_versions(budget_ceiling_id);
CREATE INDEX idx_ppmp_versions_stage   ON procurements.ppmp_versions(planning_stage);
CREATE INDEX idx_app_versions_stage    ON procurements.app_versions(planning_stage);

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
  v_ceiling_id     UUID;
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

CREATE TRIGGER trg_ppmp_version_planning_stage
  BEFORE INSERT OR UPDATE ON procurements.ppmp_versions
  FOR EACH ROW EXECUTE FUNCTION procurements.set_version_planning_stage();

CREATE TRIGGER trg_app_version_planning_stage
  BEFORE INSERT OR UPDATE ON procurements.app_versions
  FOR EACH ROW EXECUTE FUNCTION procurements.set_version_planning_stage();

-- ============================================================
-- Backfill existing rows.
--
-- Existing data cannot be reconstructed accurately: indicative_final
-- was written from approval status, so it carries no reliable signal.
-- The honest default is 'indicative' for everything except versions
-- whose FY already has a gaa/final ceiling recorded.
-- ============================================================

UPDATE procurements.ppmp_versions pv
   SET planning_stage    = procurements.fiscal_year_planning_stage(p.fiscal_year_id),
       budget_ceiling_id = procurements.authoritative_ceiling_id(p.fiscal_year_id)
  FROM procurements.ppmps p
 WHERE p.id = pv.ppmp_id
   AND pv.planning_stage IS NULL;

UPDATE procurements.app_versions av
   SET planning_stage    = procurements.fiscal_year_planning_stage(a.fiscal_year_id),
       budget_ceiling_id = procurements.authoritative_ceiling_id(a.fiscal_year_id)
  FROM procurements.apps a
 WHERE a.id = av.app_id
   AND av.planning_stage IS NULL;
