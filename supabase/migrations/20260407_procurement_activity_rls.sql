-- Phase 8: Procurement Workflows (SVP + Shopping) — Permissions + RLS

-- ============================================================
-- 1. New permissions for procurement activities
-- ============================================================
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('proc.view',      'procurement', 'View procurement activities in division',       'division'),
  ('proc.create',    'procurement', 'Create procurement activities from approved PRs','division'),
  ('proc.advance',   'procurement', 'Advance procurement stage',                     'division'),
  ('proc.fail',      'procurement', 'Mark procurement as failed',                    'division'),
  ('bid.record',     'procurement', 'Record bids/quotations from suppliers',         'division'),
  ('bid.view',       'procurement', 'View bids and quotations',                      'division'),
  ('award.recommend','procurement', 'Recommend award to supplier',                   'division'),
  ('award.approve',  'procurement', 'Approve procurement award',                     'division')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. Role-permission assignments
-- ============================================================
CREATE OR REPLACE FUNCTION procurements._seed_procurement_activity_permissions()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_role_id UUID;
  v_perm_id UUID;
  v_assignments TEXT[][] := ARRAY[
    -- proc.view: all division roles
    ARRAY['division_admin',   'proc.view'],
    ARRAY['hope',             'proc.view'],
    ARRAY['division_chief',   'proc.view'],
    ARRAY['section_chief',    'proc.view'],
    ARRAY['budget_officer',   'proc.view'],
    ARRAY['supply_officer',   'proc.view'],
    ARRAY['bac_chair',        'proc.view'],
    ARRAY['bac_member',       'proc.view'],
    ARRAY['bac_secretariat',  'proc.view'],
    ARRAY['end_user',         'proc.view'],
    ARRAY['school_head',      'proc.view'],
    ARRAY['auditor',          'proc.view'],
    ARRAY['accountant',       'proc.view'],
    -- proc.create: Supply Officer, BAC Secretariat, admin
    ARRAY['supply_officer',   'proc.create'],
    ARRAY['bac_secretariat',  'proc.create'],
    ARRAY['division_admin',   'proc.create'],
    -- proc.advance: Supply Officer, BAC Secretariat, admin
    ARRAY['supply_officer',   'proc.advance'],
    ARRAY['bac_secretariat',  'proc.advance'],
    ARRAY['division_admin',   'proc.advance'],
    -- proc.fail
    ARRAY['supply_officer',   'proc.fail'],
    ARRAY['bac_secretariat',  'proc.fail'],
    ARRAY['division_admin',   'proc.fail'],
    -- bid.record: Supply Officer, BAC Secretariat, admin
    ARRAY['supply_officer',   'bid.record'],
    ARRAY['bac_secretariat',  'bid.record'],
    ARRAY['division_admin',   'bid.record'],
    -- bid.view: all division roles
    ARRAY['division_admin',   'bid.view'],
    ARRAY['hope',             'bid.view'],
    ARRAY['division_chief',   'bid.view'],
    ARRAY['section_chief',    'bid.view'],
    ARRAY['budget_officer',   'bid.view'],
    ARRAY['supply_officer',   'bid.view'],
    ARRAY['bac_chair',        'bid.view'],
    ARRAY['bac_member',       'bid.view'],
    ARRAY['bac_secretariat',  'bid.view'],
    ARRAY['auditor',          'bid.view'],
    -- award.recommend: BAC Chair, admin
    ARRAY['bac_chair',        'award.recommend'],
    ARRAY['division_admin',   'award.recommend'],
    -- award.approve: HOPE, Division Chief, admin
    ARRAY['hope',             'award.approve'],
    ARRAY['division_chief',   'award.approve'],
    ARRAY['division_admin',   'award.approve'],
    -- Also map existing seeded permissions (proc.manage, bid.evaluate, bid.award)
    -- proc.manage is already seeded to supply_officer, bac_secretariat, division_admin
    -- bid.evaluate is already seeded to bac_chair, bac_member, division_admin
    -- bid.award is already seeded to hope, bac_chair, division_admin
    -- No action needed for those
    ARRAY['end_user',         'bid.view'],
    ARRAY['school_head',      'bid.view']
  ];
  v_pair TEXT[];
BEGIN
  FOREACH v_pair SLICE 1 IN ARRAY v_assignments
  LOOP
    SELECT id INTO v_role_id FROM procurements.roles WHERE name = v_pair[1];
    SELECT id INTO v_perm_id FROM procurements.permissions WHERE code = v_pair[2];
    IF v_role_id IS NOT NULL AND v_perm_id IS NOT NULL THEN
      INSERT INTO procurements.role_permissions (role_id, permission_id)
      VALUES (v_role_id, v_perm_id)
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

SELECT procurements._seed_procurement_activity_permissions();
DROP FUNCTION procurements._seed_procurement_activity_permissions();

-- ============================================================
-- 3. RLS policies
-- ============================================================

-- ------------------------------------------------------------
-- procurement_activities
-- ------------------------------------------------------------

-- All division members can view procurement activities
CREATE POLICY "division_read_procurement_activities" ON procurements.procurement_activities
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
  );

-- Supply Officer / BAC Secretariat / admin can create
CREATE POLICY "create_procurement_activity" ON procurements.procurement_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND (
      procurements.has_permission('proc.create')
      OR procurements.has_permission('proc.manage')
    )
    AND procurements.is_division_active()
  );

-- Authorized roles can update (stage advancement, award, etc.)
CREATE POLICY "update_procurement_activity" ON procurements.procurement_activities
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      procurements.has_permission('proc.manage')
      OR procurements.has_permission('proc.advance')
      OR procurements.has_permission('award.approve')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- ------------------------------------------------------------
-- procurement_stages
-- ------------------------------------------------------------

-- Division members can view stages
CREATE POLICY "division_read_procurement_stages" ON procurements.procurement_stages
  FOR SELECT TO authenticated
  USING (
    procurement_id IN (
      SELECT id FROM procurements.procurement_activities
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
  );

-- Authorized roles can manage stages (via RPCs with SECURITY DEFINER)
CREATE POLICY "manage_procurement_stages" ON procurements.procurement_stages
  FOR ALL TO authenticated
  USING (
    procurement_id IN (
      SELECT id FROM procurements.procurement_activities
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
    AND (
      procurements.has_permission('proc.manage')
      OR procurements.has_permission('proc.advance')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    procurement_id IN (
      SELECT id FROM procurements.procurement_activities
      WHERE division_id = procurements.get_user_division_id()
    )
  );

-- ------------------------------------------------------------
-- bids
-- ------------------------------------------------------------

-- Division members with bid.view can see bids
CREATE POLICY "division_read_bids" ON procurements.bids
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND procurement_id IN (
      SELECT id FROM procurements.procurement_activities
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
  );

-- Supply Officer / BAC Secretariat can record bids
CREATE POLICY "record_bids" ON procurements.bids
  FOR INSERT TO authenticated
  WITH CHECK (
    procurement_id IN (
      SELECT id FROM procurements.procurement_activities
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
    AND (
      procurements.has_permission('bid.record')
      OR procurements.has_permission('proc.manage')
    )
  );

-- BAC / authorized can update bids (evaluation, status changes)
CREATE POLICY "update_bids" ON procurements.bids
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND procurement_id IN (
      SELECT id FROM procurements.procurement_activities
      WHERE division_id = procurements.get_user_division_id()
        AND deleted_at IS NULL
    )
    AND (
      procurements.has_permission('bid.evaluate')
      OR procurements.has_permission('bid.record')
      OR procurements.has_permission('proc.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    procurement_id IN (
      SELECT id FROM procurements.procurement_activities
      WHERE division_id = procurements.get_user_division_id()
    )
  );

-- ------------------------------------------------------------
-- bid_items
-- ------------------------------------------------------------

-- Division members can view bid items
CREATE POLICY "division_read_bid_items" ON procurements.bid_items
  FOR SELECT TO authenticated
  USING (
    bid_id IN (
      SELECT b.id FROM procurements.bids b
      JOIN procurements.procurement_activities pa ON pa.id = b.procurement_id
      WHERE pa.division_id = procurements.get_user_division_id()
        AND pa.deleted_at IS NULL
        AND b.deleted_at IS NULL
    )
  );

-- Supply Officer / authorized can manage bid items
CREATE POLICY "manage_bid_items" ON procurements.bid_items
  FOR ALL TO authenticated
  USING (
    bid_id IN (
      SELECT b.id FROM procurements.bids b
      JOIN procurements.procurement_activities pa ON pa.id = b.procurement_id
      WHERE pa.division_id = procurements.get_user_division_id()
        AND pa.deleted_at IS NULL
    )
    AND (
      procurements.has_permission('bid.record')
      OR procurements.has_permission('proc.manage')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    bid_id IN (
      SELECT b.id FROM procurements.bids b
      JOIN procurements.procurement_activities pa ON pa.id = b.procurement_id
      WHERE pa.division_id = procurements.get_user_division_id()
    )
  );
