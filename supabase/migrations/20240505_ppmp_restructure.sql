-- Phase 5.5: Restructure PPMP from flat ppmp_items to
-- Project → Lot → Item hierarchy matching GPPB PPMP Form (RA 12009 IRR)
--
-- This migration:
-- 1. Drops the old ppmp_items table and its dependencies
-- 2. Creates ppmp_projects, ppmp_lots, ppmp_lot_items
-- 3. Replaces RPC functions, triggers, and RLS policies
-- 4. Renames total_estimated_cost → total_estimated_budget on ppmp_versions

-- ============================================================               b9i8juv bh 
-- Step 1: Drop old triggers that reference ppmp_items
-- ============================================================

DROP TRIGGER IF EXISTS trg_ppmp_items_updated_at ON procurements.ppmp_items;
DROP TRIGGER IF EXISTS trg_ppmp_items_audit ON procurements.ppmp_items;

-- Drop the APP auto-populate trigger (will be recreated)
DROP TRIGGER IF EXISTS trg_auto_populate_app_from_ppmp ON procurements.ppmps;
DROP FUNCTION IF EXISTS procurements.auto_populate_app_from_ppmp() CASCADE;

-- Drop the snapshot trigger (will be recreated)
DROP TRIGGER IF EXISTS trg_snapshot_approved_ppmp_version ON procurements.ppmp_versions;
DROP FUNCTION IF EXISTS procurements.snapshot_approved_ppmp_version() CASCADE;

-- Drop the version history RPC (will be recreated)
DROP FUNCTION IF EXISTS procurements.get_ppmp_version_history(UUID) CASCADE;

-- Drop the amendment RPC (will be recreated)
DROP FUNCTION IF EXISTS procurements.create_ppmp_amendment(UUID, TEXT) CASCADE;

-- Drop the submit RPC (will be recreated)
DROP FUNCTION IF EXISTS procurements.submit_ppmp(UUID) CASCADE;

-- ============================================================
-- Step 2: Drop old RLS policies on ppmp_items
-- ============================================================

DROP POLICY IF EXISTS "division_read_ppmp_items" ON procurements.ppmp_items;
DROP POLICY IF EXISTS "end_user_manage_ppmp_items" ON procurements.ppmp_items;

-- ============================================================
-- Step 3: Drop old ppmp_items table
-- ============================================================

DROP TABLE IF EXISTS procurements.ppmp_items CASCADE;

-- ============================================================
-- Step 4: Rename column on ppmp_versions
-- ============================================================

ALTER TABLE procurements.ppmp_versions
  RENAME COLUMN total_estimated_cost TO total_estimated_budget;

-- ============================================================
-- Step 5: Create new tables
-- ============================================================

-- ppmp_projects: Each procurement project (GPPB Columns 1-2)
CREATE TABLE IF NOT EXISTS procurements.ppmp_projects (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ppmp_version_id       UUID          NOT NULL REFERENCES procurements.ppmp_versions(id) ON DELETE CASCADE,
  ppmp_id               UUID          NOT NULL REFERENCES procurements.ppmps(id),
  project_number        INTEGER       NOT NULL,
  -- Column 1: General Description and Objective
  general_description   TEXT          NOT NULL,
  -- Column 2: Type of Project (Goods, Infrastructure, Consulting Services)
  project_type          TEXT          NOT NULL
                          CHECK (project_type IN ('goods','infrastructure','consulting_services')),
  office_id             UUID          NOT NULL REFERENCES procurements.offices(id),
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by            UUID          REFERENCES auth.users(id)
);

CREATE INDEX idx_ppmp_projects_version_id  ON procurements.ppmp_projects(ppmp_version_id);
CREATE INDEX idx_ppmp_projects_ppmp_id     ON procurements.ppmp_projects(ppmp_id);
CREATE INDEX idx_ppmp_projects_office_id   ON procurements.ppmp_projects(office_id);
CREATE INDEX idx_ppmp_projects_deleted_at  ON procurements.ppmp_projects(deleted_at) WHERE deleted_at IS NULL;

-- ppmp_lots: Each lot is a row in the PPMP form (GPPB Columns 3-12)
CREATE TABLE IF NOT EXISTS procurements.ppmp_lots (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ppmp_project_id             UUID          NOT NULL REFERENCES procurements.ppmp_projects(id) ON DELETE CASCADE,
  lot_number                  INTEGER       NOT NULL DEFAULT 1,
  lot_title                   TEXT,
  -- Column 4: Recommended Mode of Procurement
  procurement_mode            TEXT          NOT NULL DEFAULT 'competitive_bidding',
  -- Column 5: Pre-Procurement Conference
  pre_procurement_conference  BOOLEAN       NOT NULL DEFAULT false,
  -- Column 6: Start of Procurement Activity (MM/YYYY)
  procurement_start           TEXT,
  -- Column 7: End of Procurement Activity (MM/YYYY)
  procurement_end             TEXT,
  -- Column 8: Expected Delivery/Implementation Period
  delivery_period             TEXT,
  -- Column 9: Source of Funds
  source_of_funds             TEXT,
  -- Column 10: Estimated Budget / ABC
  estimated_budget            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (estimated_budget >= 0),
  -- Column 11: Attached Supporting Documents
  supporting_documents        TEXT,
  -- Column 12: Remarks
  remarks                     TEXT,
  -- Budget linkage
  budget_allocation_id        UUID          REFERENCES procurements.budget_allocations(id),
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ppmp_lots_project_id ON procurements.ppmp_lots(ppmp_project_id);
CREATE INDEX idx_ppmp_lots_budget_id  ON procurements.ppmp_lots(budget_allocation_id);

-- ppmp_lot_items: Individual items within a lot (Column 3: Quantity and Size)
CREATE TABLE IF NOT EXISTS procurements.ppmp_lot_items (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ppmp_lot_id           UUID          NOT NULL REFERENCES procurements.ppmp_lots(id) ON DELETE CASCADE,
  item_number           INTEGER       NOT NULL DEFAULT 1,
  description           TEXT          NOT NULL,
  quantity              NUMERIC(15,4) NOT NULL CHECK (quantity > 0),
  unit                  TEXT          NOT NULL,
  specification         TEXT,
  estimated_unit_cost   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (estimated_unit_cost >= 0),
  estimated_total_cost  NUMERIC(15,2) GENERATED ALWAYS AS (quantity * estimated_unit_cost) STORED,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ppmp_lot_items_lot_id ON procurements.ppmp_lot_items(ppmp_lot_id);

-- ============================================================
-- Step 6: Triggers for new tables
-- ============================================================

CREATE TRIGGER trg_ppmp_projects_updated_at
  BEFORE UPDATE ON procurements.ppmp_projects
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_ppmp_lots_updated_at
  BEFORE UPDATE ON procurements.ppmp_lots
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_ppmp_lot_items_updated_at
  BEFORE UPDATE ON procurements.ppmp_lot_items
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

CREATE TRIGGER trg_ppmp_projects_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.ppmp_projects
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_ppmp_lots_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.ppmp_lots
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

CREATE TRIGGER trg_ppmp_lot_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON procurements.ppmp_lot_items
  FOR EACH ROW EXECUTE FUNCTION procurements.audit_trigger();

-- ============================================================
-- Step 7: Enable RLS on new tables
-- ============================================================

ALTER TABLE procurements.ppmp_projects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.ppmp_lots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.ppmp_lot_items ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Step 8: RLS Policies for new tables
-- ============================================================

-- ppmp_projects
CREATE POLICY "division_read_ppmp_projects" ON procurements.ppmp_projects
  FOR SELECT TO authenticated
  USING (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
    AND deleted_at IS NULL
  );

CREATE POLICY "end_user_manage_ppmp_projects" ON procurements.ppmp_projects
  FOR ALL TO authenticated
  USING (
    (
      created_by = auth.uid()
      OR procurements.has_permission('ppmp.edit')
    )
    AND office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
  )
  WITH CHECK (
    office_id IN (
      SELECT id FROM procurements.offices
      WHERE division_id = procurements.get_user_division_id()
    )
    AND procurements.is_division_active()
  );

-- ppmp_lots
CREATE POLICY "division_read_ppmp_lots" ON procurements.ppmp_lots
  FOR SELECT TO authenticated
  USING (
    ppmp_project_id IN (
      SELECT pp.id FROM procurements.ppmp_projects pp
      WHERE pp.office_id IN (
        SELECT id FROM procurements.offices
        WHERE division_id = procurements.get_user_division_id()
      )
      AND pp.deleted_at IS NULL
    )
  );

CREATE POLICY "end_user_manage_ppmp_lots" ON procurements.ppmp_lots
  FOR ALL TO authenticated
  USING (
    ppmp_project_id IN (
      SELECT pp.id FROM procurements.ppmp_projects pp
      WHERE (
        pp.created_by = auth.uid()
        OR procurements.has_permission('ppmp.edit')
      )
      AND pp.office_id IN (
        SELECT id FROM procurements.offices
        WHERE division_id = procurements.get_user_division_id()
      )
    )
  );

-- ppmp_lot_items
CREATE POLICY "division_read_ppmp_lot_items" ON procurements.ppmp_lot_items
  FOR SELECT TO authenticated
  USING (
    ppmp_lot_id IN (
      SELECT pl.id FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
      WHERE pp.office_id IN (
        SELECT id FROM procurements.offices
        WHERE division_id = procurements.get_user_division_id()
      )
      AND pp.deleted_at IS NULL
    )
  );

CREATE POLICY "end_user_manage_ppmp_lot_items" ON procurements.ppmp_lot_items
  FOR ALL TO authenticated
  USING (
    ppmp_lot_id IN (
      SELECT pl.id FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
      WHERE (
        pp.created_by = auth.uid()
        OR procurements.has_permission('ppmp.edit')
      )
      AND pp.office_id IN (
        SELECT id FROM procurements.offices
        WHERE division_id = procurements.get_user_division_id()
      )
    )
  );

-- ============================================================
-- Step 9: Recreate RPC functions for new structure
-- ============================================================

-- submit_ppmp
CREATE OR REPLACE FUNCTION procurements.submit_ppmp(
  p_ppmp_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp          RECORD;
  v_project_count INTEGER;
  v_version_id    UUID;
  v_alloc_rec     RECORD;
BEGIN
  SELECT *
    INTO v_ppmp
    FROM procurements.ppmps
   WHERE id          = p_ppmp_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  IF v_ppmp.created_by <> auth.uid()
    AND NOT procurements.has_permission('ppmp.submit')
  THEN
    RAISE EXCEPTION 'Insufficient permissions to submit PPMP %', p_ppmp_id;
  END IF;

  IF v_ppmp.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft PPMPs can be submitted (current status: %)', v_ppmp.status;
  END IF;

  SELECT id INTO v_version_id
    FROM procurements.ppmp_versions
   WHERE ppmp_id        = p_ppmp_id
     AND version_number = v_ppmp.current_version;

  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'No version found for PPMP % (version %)', p_ppmp_id, v_ppmp.current_version;
  END IF;

  -- At least one project must exist
  SELECT COUNT(*) INTO v_project_count
    FROM procurements.ppmp_projects
   WHERE ppmp_version_id = v_version_id
     AND deleted_at      IS NULL;

  IF v_project_count = 0 THEN
    RAISE EXCEPTION 'Cannot submit PPMP % — it has no procurement projects', p_ppmp_id;
  END IF;

  -- Every project must have at least one lot with at least one item
  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_projects pp
     WHERE pp.ppmp_version_id = v_version_id
       AND pp.deleted_at      IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM procurements.ppmp_lots pl
           JOIN procurements.ppmp_lot_items pli ON pli.ppmp_lot_id = pl.id
          WHERE pl.ppmp_project_id = pp.id
       )
  ) THEN
    RAISE EXCEPTION 'All procurement projects must have at least one lot with items';
  END IF;

  -- Every lot must have estimated_budget > 0
  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_lots pl
      JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
     WHERE pp.ppmp_version_id = v_version_id
       AND pp.deleted_at      IS NULL
       AND pl.estimated_budget <= 0
  ) THEN
    RAISE EXCEPTION 'All lots must have an estimated budget greater than zero';
  END IF;

  -- Budget availability check
  FOR v_alloc_rec IN
    SELECT
      pl.budget_allocation_id,
      SUM(pl.estimated_budget) AS ppmp_total,
      ba.adjusted_amount,
      ba.obligated_amount
    FROM procurements.ppmp_lots pl
    JOIN procurements.ppmp_projects pp ON pp.id = pl.ppmp_project_id
    JOIN procurements.budget_allocations ba ON ba.id = pl.budget_allocation_id
   WHERE pp.ppmp_version_id   = v_version_id
     AND pp.deleted_at        IS NULL
     AND pl.budget_allocation_id IS NOT NULL
   GROUP BY pl.budget_allocation_id, ba.adjusted_amount, ba.obligated_amount
  LOOP
    IF v_alloc_rec.ppmp_total > (v_alloc_rec.adjusted_amount - v_alloc_rec.obligated_amount) THEN
      RAISE EXCEPTION
        'PPMP lots for allocation % exceed available budget (PPMP total: %, available: %)',
        v_alloc_rec.budget_allocation_id,
        v_alloc_rec.ppmp_total,
        (v_alloc_rec.adjusted_amount - v_alloc_rec.obligated_amount);
    END IF;
  END LOOP;

  UPDATE procurements.ppmps
     SET status       = 'submitted',
         submitted_at = NOW(),
         submitted_by = auth.uid(),
         updated_at   = NOW()
   WHERE id = p_ppmp_id;

  UPDATE procurements.ppmp_versions
     SET status = 'submitted'
   WHERE id = v_version_id;
END;
$$;

-- create_ppmp_amendment: deep-clone projects → lots → items
CREATE OR REPLACE FUNCTION procurements.create_ppmp_amendment(
  p_ppmp_id       UUID,
  p_justification TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp            RECORD;
  v_approved_ver    RECORD;
  v_next_version    INTEGER;
  v_new_version_id  UUID;
  v_proj_rec        RECORD;
  v_new_project_id  UUID;
  v_lot_rec         RECORD;
  v_new_lot_id      UUID;
BEGIN
  SELECT *
    INTO v_ppmp
    FROM procurements.ppmps
   WHERE id          = p_ppmp_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  IF v_ppmp.created_by <> auth.uid()
    AND NOT procurements.has_permission('ppmp.amend')
  THEN
    RAISE EXCEPTION 'Insufficient permissions to amend PPMP %', p_ppmp_id;
  END IF;

  IF v_ppmp.status NOT IN ('approved', 'locked') THEN
    RAISE EXCEPTION 'Only approved or locked PPMPs can be amended (current status: %)', v_ppmp.status;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM procurements.ppmp_versions
     WHERE ppmp_id = p_ppmp_id
       AND status  = 'draft'
  ) THEN
    RAISE EXCEPTION 'An amendment is already in progress for PPMP %. Finish or discard it first.', p_ppmp_id;
  END IF;

  SELECT *
    INTO v_approved_ver
    FROM procurements.ppmp_versions
   WHERE ppmp_id = p_ppmp_id
     AND status  = 'approved'
   ORDER BY version_number DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No approved version found for PPMP % to base amendment on', p_ppmp_id;
  END IF;

  v_next_version := v_ppmp.current_version + 1;

  INSERT INTO procurements.ppmp_versions (
    ppmp_id, version_number, version_type, amendment_justification,
    total_estimated_budget, status, indicative_final, office_id, created_by
  ) VALUES (
    p_ppmp_id, v_next_version, 'amendment', p_justification,
    v_approved_ver.total_estimated_budget, 'draft', 'indicative',
    v_approved_ver.office_id, auth.uid()
  )
  RETURNING id INTO v_new_version_id;

  -- Clone projects → lots → items
  FOR v_proj_rec IN
    SELECT * FROM procurements.ppmp_projects
     WHERE ppmp_version_id = v_approved_ver.id
       AND deleted_at      IS NULL
  LOOP
    INSERT INTO procurements.ppmp_projects (
      ppmp_version_id, ppmp_id, project_number,
      general_description, project_type, office_id, created_by
    ) VALUES (
      v_new_version_id, v_proj_rec.ppmp_id, v_proj_rec.project_number,
      v_proj_rec.general_description, v_proj_rec.project_type,
      v_proj_rec.office_id, auth.uid()
    )
    RETURNING id INTO v_new_project_id;

    FOR v_lot_rec IN
      SELECT * FROM procurements.ppmp_lots
       WHERE ppmp_project_id = v_proj_rec.id
    LOOP
      INSERT INTO procurements.ppmp_lots (
        ppmp_project_id, lot_number, lot_title, procurement_mode,
        pre_procurement_conference, procurement_start, procurement_end,
        delivery_period, source_of_funds, estimated_budget,
        supporting_documents, remarks, budget_allocation_id
      ) VALUES (
        v_new_project_id, v_lot_rec.lot_number, v_lot_rec.lot_title,
        v_lot_rec.procurement_mode, v_lot_rec.pre_procurement_conference,
        v_lot_rec.procurement_start, v_lot_rec.procurement_end,
        v_lot_rec.delivery_period, v_lot_rec.source_of_funds,
        v_lot_rec.estimated_budget, v_lot_rec.supporting_documents,
        v_lot_rec.remarks, v_lot_rec.budget_allocation_id
      )
      RETURNING id INTO v_new_lot_id;

      INSERT INTO procurements.ppmp_lot_items (
        ppmp_lot_id, item_number, description, quantity, unit,
        specification, estimated_unit_cost
      )
      SELECT
        v_new_lot_id, item_number, description, quantity, unit,
        specification, estimated_unit_cost
      FROM procurements.ppmp_lot_items
      WHERE ppmp_lot_id = v_lot_rec.id;
    END LOOP;
  END LOOP;

  UPDATE procurements.ppmps
     SET current_version = v_next_version,
         status          = 'draft',
         updated_at      = NOW()
   WHERE id = p_ppmp_id;

  RETURN v_new_version_id;
END;
$$;

-- get_ppmp_version_history
CREATE OR REPLACE FUNCTION procurements.get_ppmp_version_history(
  p_ppmp_id UUID
)
RETURNS TABLE (
  version_number          INTEGER,
  version_type            TEXT,
  status                  TEXT,
  indicative_final        TEXT,
  total_estimated_budget  NUMERIC(15,2),
  amendment_justification TEXT,
  approved_by             UUID,
  approved_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ,
  project_count           BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM procurements.ppmps
     WHERE id          = p_ppmp_id
       AND division_id = procurements.get_user_division_id()
       AND deleted_at  IS NULL
  ) THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  RETURN QUERY
  SELECT
    pv.version_number,
    pv.version_type,
    pv.status,
    pv.indicative_final,
    pv.total_estimated_budget,
    pv.amendment_justification,
    pv.approved_by,
    pv.approved_at,
    pv.created_at,
    COUNT(pp.id) AS project_count
  FROM procurements.ppmp_versions pv
  LEFT JOIN procurements.ppmp_projects pp
         ON pp.ppmp_version_id = pv.id
        AND pp.deleted_at      IS NULL
  WHERE pv.ppmp_id = p_ppmp_id
  GROUP BY
    pv.version_number,
    pv.version_type,
    pv.status,
    pv.indicative_final,
    pv.total_estimated_budget,
    pv.amendment_justification,
    pv.approved_by,
    pv.approved_at,
    pv.created_at
  ORDER BY pv.version_number DESC;
END;
$$;

-- ============================================================
-- Step 10: Recreate triggers for new structure
-- ============================================================

-- Snapshot: captures project → lot → item hierarchy
CREATE OR REPLACE FUNCTION procurements.snapshot_approved_ppmp_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_projects JSONB;
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'project', row_to_json(pp.*),
        'lots', (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'lot', row_to_json(pl.*),
              'items', (
                SELECT COALESCE(jsonb_agg(row_to_json(pli.*)), '[]'::jsonb)
                  FROM procurements.ppmp_lot_items pli
                 WHERE pli.ppmp_lot_id = pl.id
              )
            )
          ), '[]'::jsonb)
          FROM procurements.ppmp_lots pl
          WHERE pl.ppmp_project_id = pp.id
        )
      )
    )
    INTO v_projects
    FROM procurements.ppmp_projects pp
    WHERE pp.ppmp_version_id = NEW.id
      AND pp.deleted_at      IS NULL;

    NEW.snapshot_data = jsonb_build_object(
      'version',        row_to_json(NEW.*),
      'projects',       COALESCE(v_projects, '[]'::jsonb),
      'snapshotted_at', NOW()
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Must fire BEFORE the immutability guard
CREATE TRIGGER trg_snapshot_approved_ppmp_version
  BEFORE UPDATE ON procurements.ppmp_versions
  FOR EACH ROW
  EXECUTE FUNCTION procurements.snapshot_approved_ppmp_version();

-- APP auto-populate: each lot becomes an APP item
CREATE OR REPLACE FUNCTION procurements.auto_populate_app_from_ppmp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_app_id         UUID;
  v_app_version_id UUID;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'procurements'
       AND table_name   = 'app_items'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_app_id
    FROM procurements.apps
   WHERE division_id    = NEW.division_id
     AND fiscal_year_id = NEW.fiscal_year_id
     AND deleted_at     IS NULL
   LIMIT 1;

  IF v_app_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_app_version_id
    FROM procurements.app_versions
   WHERE app_id  = v_app_id
     AND status  NOT IN ('final','approved')
   ORDER BY version_number DESC
   LIMIT 1;

  IF v_app_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO procurements.app_items (
    app_version_id,
    app_id,
    source_ppmp_project_id,
    source_ppmp_lot_id,
    source_ppmp_id,
    item_number,
    general_description,
    project_type,
    procurement_mode,
    estimated_budget,
    source_of_funds,
    procurement_start,
    procurement_end,
    delivery_period,
    budget_allocation_id,
    source_office_id,
    remarks,
    hope_review_status,
    created_by
  )
  SELECT
    v_app_version_id,
    v_app_id,
    pp.id,
    pl.id,
    pp.ppmp_id,
    ROW_NUMBER() OVER (ORDER BY pp.project_number, pl.lot_number),
    pp.general_description,
    pp.project_type,
    pl.procurement_mode,
    pl.estimated_budget,
    pl.source_of_funds,
    pl.procurement_start,
    pl.procurement_end,
    pl.delivery_period,
    pl.budget_allocation_id,
    pp.office_id,
    pl.remarks,
    'pending',
    pp.created_by
  FROM procurements.ppmp_projects pp
  JOIN procurements.ppmp_versions pv ON pv.id = pp.ppmp_version_id
  JOIN procurements.ppmp_lots pl ON pl.ppmp_project_id = pp.id
  WHERE pv.ppmp_id   = NEW.id
    AND pv.status    = 'approved'
    AND pp.deleted_at IS NULL;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_populate_app_from_ppmp
  AFTER UPDATE ON procurements.ppmps
  FOR EACH ROW
  EXECUTE FUNCTION procurements.auto_populate_app_from_ppmp();
