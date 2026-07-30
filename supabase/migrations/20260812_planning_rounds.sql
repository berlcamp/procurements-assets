-- ============================================================
-- Planning rounds.
--
-- When the GAA lands and the ceiling changes, EVERY office must revise its
-- PPMP. That is one division decision with a deadline, not 40 independent
-- discoveries. A round:
--   * records which ceiling triggered it
--   * opens a stage-tagged amendment version on every approved PPMP
--   * tracks per-office compliance so the SDS can see who has not filed
--
-- P2 note: this migration performs NO backfill UPDATE. It adds one trigger to
-- procurements.ppmps (AFTER UPDATE OF status). That trigger writes only to
-- planning_round_offices, whose own triggers are updated_at + audit and cascade
-- nowhere, so it introduces no guard collision. It cannot fire on Task 9's
-- consolidation writes either: those touch consolidation_status, never status.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS procurements.planning_rounds (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id        UUID          NOT NULL REFERENCES platform.divisions(id),
  fiscal_year_id     UUID          NOT NULL REFERENCES procurements.fiscal_years(id),
  budget_ceiling_id  UUID          NOT NULL REFERENCES procurements.budget_ceilings(id),

  -- Denormalised from the ceiling for display and reporting.
  planning_stage     TEXT          NOT NULL
                       CHECK (planning_stage IN ('indicative','final','supplemental')),

  instructions       TEXT,
  deadline           DATE,

  status             TEXT          NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','closed','cancelled')),

  opened_by          UUID          REFERENCES auth.users(id),
  opened_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  closed_by          UUID          REFERENCES auth.users(id),
  closed_at          TIMESTAMPTZ,

  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.planning_rounds IS
  'A division-wide instruction for all offices to revise their PPMPs against a new budget ceiling.';

CREATE INDEX IF NOT EXISTS idx_planning_rounds_division    ON procurements.planning_rounds(division_id);
CREATE INDEX IF NOT EXISTS idx_planning_rounds_fiscal_year ON procurements.planning_rounds(fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_planning_rounds_deleted_at  ON procurements.planning_rounds(deleted_at) WHERE deleted_at IS NULL;

-- fiscal_years is already division-scoped, so one open round per fiscal year is
-- inherently one per division.
CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_rounds_one_open_per_fy
  ON procurements.planning_rounds (fiscal_year_id)
  WHERE status = 'open' AND deleted_at IS NULL;

-- ============================================================
-- Per-office compliance tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS procurements.planning_round_offices (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_round_id  UUID          NOT NULL REFERENCES procurements.planning_rounds(id) ON DELETE CASCADE,
  office_id          UUID          NOT NULL REFERENCES procurements.offices(id),
  ppmp_id            UUID          NOT NULL REFERENCES procurements.ppmps(id),
  ppmp_version_id    UUID          REFERENCES procurements.ppmp_versions(id),

  status             TEXT          NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','in_progress','submitted','approved','skipped')),
  skip_reason        TEXT,
  completed_at       TIMESTAMPTZ,

  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (planning_round_id, ppmp_id)
);

COMMENT ON TABLE procurements.planning_round_offices IS
  'One row per PPMP caught by a planning round. status tracks whether that office has filed its revision; skip_reason records why a PPMP could not be amended automatically.';

CREATE INDEX IF NOT EXISTS idx_pro_round   ON procurements.planning_round_offices(planning_round_id);
CREATE INDEX IF NOT EXISTS idx_pro_office  ON procurements.planning_round_offices(office_id);
CREATE INDEX IF NOT EXISTS idx_pro_ppmp    ON procurements.planning_round_offices(ppmp_id);
CREATE INDEX IF NOT EXISTS idx_pro_status  ON procurements.planning_round_offices(status);

DROP TRIGGER IF EXISTS trg_planning_rounds_updated_at ON procurements.planning_rounds;
CREATE TRIGGER trg_planning_rounds_updated_at
  BEFORE UPDATE ON procurements.planning_rounds
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

DROP TRIGGER IF EXISTS trg_pro_updated_at ON procurements.planning_round_offices;
CREATE TRIGGER trg_pro_updated_at
  BEFORE UPDATE ON procurements.planning_round_offices
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

DROP TRIGGER IF EXISTS trg_planning_rounds_audit ON procurements.planning_rounds;
CREATE TRIGGER trg_planning_rounds_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.planning_rounds
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

DROP TRIGGER IF EXISTS trg_pro_audit ON procurements.planning_round_offices;
CREATE TRIGGER trg_pro_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.planning_round_offices
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- Permissions
-- ============================================================

INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('planning.rounds_manage', 'planning',
   'Open and close division-wide PPMP revision rounds', 'division')
ON CONFLICT (code) DO NOTHING;

INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM procurements.roles r
CROSS JOIN procurements.permissions p
WHERE r.name IN ('division_admin','budget_officer','hope')
  AND p.code IN ('planning.rounds_manage')
ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS
--
-- Write policies use the TOP-LEVEL super-admin bypass mandated by this plan's
-- Global Constraints and proven in 20260405_user_roles_super_admin_access.sql.
-- The shape the task body originally carried --
--   USING (division_id = ... AND (has_permission(...) OR is_super_admin()))
-- -- is DEAD CODE for a platform admin, whose get_user_division_id() is NULL,
-- and blocks INSERT outright because INSERT evaluates only WITH CHECK.
--
-- And WITH CHECK must repeat the permission block. A policy with USING but no
-- WITH CHECK has USING copied into it implicitly; writing an explicit WITH
-- CHECK that omits the permission test therefore REMOVES a gate while looking
-- like tightening. That exact mistake was a privilege escalation in Task 7.
-- ============================================================

ALTER TABLE procurements.planning_rounds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.planning_round_offices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "division_read_planning_rounds" ON procurements.planning_rounds;
CREATE POLICY "division_read_planning_rounds" ON procurements.planning_rounds
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS "manage_planning_rounds" ON procurements.planning_rounds;
CREATE POLICY "manage_planning_rounds" ON procurements.planning_rounds
  FOR ALL TO authenticated
  USING (
    platform.is_super_admin()
    OR (division_id = procurements.get_user_division_id()
        AND procurements.has_permission('planning.rounds_manage'))
  )
  WITH CHECK (
    platform.is_super_admin()
    OR (division_id = procurements.get_user_division_id()
        AND procurements.has_permission('planning.rounds_manage')
        AND procurements.is_division_active())
  );

DROP POLICY IF EXISTS "division_read_planning_round_offices" ON procurements.planning_round_offices;
CREATE POLICY "division_read_planning_round_offices" ON procurements.planning_round_offices
  FOR SELECT TO authenticated
  USING (
    planning_round_id IN (
      SELECT id FROM procurements.planning_rounds
       WHERE division_id = procurements.get_user_division_id()
         AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "manage_planning_round_offices" ON procurements.planning_round_offices;
CREATE POLICY "manage_planning_round_offices" ON procurements.planning_round_offices
  FOR ALL TO authenticated
  USING (
    platform.is_super_admin()
    OR (planning_round_id IN (
          SELECT id FROM procurements.planning_rounds
           WHERE division_id = procurements.get_user_division_id()
             AND deleted_at IS NULL
        )
        AND procurements.has_permission('planning.rounds_manage'))
  )
  WITH CHECK (
    platform.is_super_admin()
    OR (planning_round_id IN (
          SELECT id FROM procurements.planning_rounds
           WHERE division_id = procurements.get_user_division_id()
             AND deleted_at IS NULL
        )
        AND procurements.has_permission('planning.rounds_manage')
        AND procurements.is_division_active())
  );

-- ============================================================
-- open_planning_round: the campaign action.
--
-- Creates the round, then opens an amendment on every approved PPMP in the
-- fiscal year. A PPMP that cannot be amended is recorded as 'skipped' WITH A
-- REASON rather than aborting the round -- the division still needs the other
-- 39 offices to revise.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.open_planning_round(
  p_fiscal_year_id    UUID,
  p_budget_ceiling_id UUID,
  p_deadline          DATE    DEFAULT NULL,
  p_instructions      TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_division_id     UUID;
  v_ceiling         RECORD;
  v_planning_stage  TEXT;
  v_round_id        UUID;
  v_ppmp            RECORD;
  v_new_version_id  UUID;
  v_skip_reason     TEXT;
BEGIN
  v_division_id := procurements.get_user_division_id();

  IF NOT procurements.has_permission('planning.rounds_manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to open a planning round';
  END IF;

  IF NOT procurements.is_division_active() THEN
    RAISE EXCEPTION 'Cannot open a planning round in an inactive division';
  END IF;

  SELECT * INTO v_ceiling
    FROM procurements.budget_ceilings
   WHERE id          = p_budget_ceiling_id
     AND division_id = v_division_id
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget ceiling % not found or access denied', p_budget_ceiling_id;
  END IF;

  IF v_ceiling.fiscal_year_id <> p_fiscal_year_id THEN
    RAISE EXCEPTION
      'Ceiling % belongs to a different fiscal year than the one requested',
      p_budget_ceiling_id;
  END IF;

  v_planning_stage := procurements.ceiling_stage_to_planning_stage(v_ceiling.stage);

  -- ceiling_stage_to_planning_stage has no ELSE branch and returns NULL for a
  -- stage outside the five known ones. planning_rounds.planning_stage is NOT
  -- NULL, so a NULL would surface as a bare not-null violation naming a column
  -- rather than the actual problem. Say what went wrong instead.
  IF v_planning_stage IS NULL THEN
    RAISE EXCEPTION
      'Ceiling % has stage %, which does not map to a planning stage.',
      p_budget_ceiling_id, v_ceiling.stage;
  END IF;

  INSERT INTO procurements.planning_rounds (
    division_id, fiscal_year_id, budget_ceiling_id, planning_stage,
    instructions, deadline, opened_by
  ) VALUES (
    v_division_id, p_fiscal_year_id, p_budget_ceiling_id, v_planning_stage,
    p_instructions, p_deadline, auth.uid()
  )
  RETURNING id INTO v_round_id;

  -- Open an amendment on every approved PPMP in this fiscal year.
  FOR v_ppmp IN
    SELECT p.*
      FROM procurements.ppmps p
     WHERE p.division_id    = v_division_id
       AND p.fiscal_year_id = p_fiscal_year_id
       AND p.deleted_at     IS NULL
       AND p.status IN ('approved','locked')
     ORDER BY p.office_id
  LOOP
    v_skip_reason := NULL;
    v_new_version_id := NULL;

    -- Do not fight in-flight procurement; record and move on. After 20260810
    -- this means a RELEASED or in-procurement lot, not merely a composed one.
    IF EXISTS (SELECT 1 FROM procurements.ppmp_has_inflight_procurement(v_ppmp.id)) THEN
      v_skip_reason := 'Has APP items already in procurement; revise manually with an override.';
    ELSE
      -- Per-PPMP subtransaction. One office's failure must not cost the round.
      BEGIN
        v_new_version_id := procurements.create_ppmp_amendment(
          v_ppmp.id,
          'Revision for ' || UPPER(v_planning_stage) || ' ceiling'
            || COALESCE(' (' || v_ceiling.reference_number || ')', '')
            || COALESCE('. ' || p_instructions, ''),
          false
        );
      EXCEPTION WHEN OTHERS THEN
        v_skip_reason := 'Amendment could not be opened: ' || SQLERRM;
      END;
    END IF;

    INSERT INTO procurements.planning_round_offices (
      planning_round_id, office_id, ppmp_id, ppmp_version_id, status, skip_reason
    ) VALUES (
      v_round_id, v_ppmp.office_id, v_ppmp.id, v_new_version_id,
      CASE WHEN v_skip_reason IS NULL THEN 'in_progress' ELSE 'skipped' END,
      v_skip_reason
    );

    -- Tell the office.
    --
    -- *** procurements.user_profiles HAS NO user_id COLUMN. *** Its PRIMARY KEY
    -- IS the auth.users id (20240302_user_profiles.sql:3). plpgsql does not
    -- resolve column names at CREATE time, so `up.user_id` here would create
    -- cleanly and then raise the FIRST time anyone opened a round -- aborting
    -- the entire campaign on the notification step. This is the identical
    -- defect that reached Task 9's record_consolidation_failure. Join on up.id.
    --
    -- Best-effort, like Task 9's side-writes: a notification failure must not
    -- undo a round that has already amended 40 PPMPs. The compliance rows above
    -- are the load-bearing record; the notification is a convenience.
    BEGIN
      INSERT INTO procurements.notifications (
        user_id, title, message, type, reference_type, reference_id, office_id
      )
      SELECT DISTINCT up.id,
             'Revise your PPMP: ' || UPPER(v_planning_stage) || ' ceiling issued',
             COALESCE(p_instructions,
                      'A new budget ceiling has been recorded. Revise your PPMP to match.')
               || COALESCE(' Deadline: ' || p_deadline::TEXT, ''),
             'approval',
             'ppmp',
             v_ppmp.id,
             v_ppmp.office_id
        FROM procurements.user_profiles up
       WHERE up.division_id = v_division_id
         AND up.office_id   = v_ppmp.office_id
         AND up.deleted_at  IS NULL
         AND up.is_active;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'open_planning_round: notification failed for PPMP %: %',
        v_ppmp.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_round_id;
END;
$$;

COMMENT ON FUNCTION procurements.open_planning_round(UUID, UUID, DATE, TEXT) IS
  'Opens a division-wide PPMP revision round against a budget ceiling: creates the round, opens an amendment on every approved/locked PPMP in the fiscal year, records per-office compliance, and notifies each office. PPMPs with in-flight procurement are recorded as skipped rather than aborting the round.';

GRANT EXECUTE ON FUNCTION procurements.open_planning_round(UUID, UUID, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION procurements.close_planning_round(
  p_round_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_round RECORD;
BEGIN
  SELECT * INTO v_round
    FROM procurements.planning_rounds
   WHERE id          = p_round_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Planning round % not found or access denied', p_round_id;
  END IF;

  IF NOT procurements.has_permission('planning.rounds_manage') THEN
    RAISE EXCEPTION 'Insufficient permissions to close a planning round';
  END IF;

  IF v_round.status <> 'open' THEN
    RAISE EXCEPTION 'Round % is already %', p_round_id, v_round.status;
  END IF;

  UPDATE procurements.planning_rounds
     SET status     = 'closed',
         closed_by  = auth.uid(),
         closed_at  = NOW(),
         updated_at = NOW()
   WHERE id = p_round_id;
END;
$$;

COMMENT ON FUNCTION procurements.close_planning_round(UUID) IS
  'Closes an open planning round. Does not alter per-office compliance rows -- they remain the record of who filed and who did not.';

GRANT EXECUTE ON FUNCTION procurements.close_planning_round(UUID) TO authenticated;

-- ============================================================
-- Keep per-office status in step with the PPMP's own progress.
-- ============================================================

CREATE OR REPLACE FUNCTION procurements.sync_planning_round_office_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  -- Redundant against the trigger's own WHEN clause, kept so the function is
  -- still correct if it is ever attached without one.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  UPDATE procurements.planning_round_offices pro
     SET status = CASE
           WHEN NEW.status = 'approved'  THEN 'approved'
           WHEN NEW.status = 'submitted' THEN 'submitted'
           ELSE pro.status
         END,
         completed_at = CASE WHEN NEW.status = 'approved' THEN NOW() ELSE pro.completed_at END,
         updated_at   = NOW()
    FROM procurements.planning_rounds pr
   WHERE pro.planning_round_id = pr.id
     AND pro.ppmp_id           = NEW.id
     AND pr.status             = 'open'
     AND pro.status NOT IN ('approved','skipped');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_planning_round_office_status ON procurements.ppmps;
CREATE TRIGGER trg_sync_planning_round_office_status
  AFTER UPDATE OF status ON procurements.ppmps
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION procurements.sync_planning_round_office_status();

COMMIT;
