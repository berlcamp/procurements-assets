-- Phase 8.5 Step 2 — Procurement-execution lots
--
-- Adds the data model for lot-based bidding at the procurement-execution
-- level. Phase 6 already has app_lots (planning lots); this is the
-- execution-side mirror because the BAC may re-lot during procurement
-- (e.g. split or merge planning lots into different execution lots).
--
-- For SVP/Shopping the lot table is normally empty — those methods run
-- as a single de-facto lot, and bids.lot_id stays NULL. For Competitive
-- Bidding (Phase 9) the BAC will create one or more lots and bids will
-- be required to reference one.
--
-- Non-destructive.

-- ============================================================
-- 1. procurement_lots table
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.procurement_lots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id        UUID NOT NULL REFERENCES procurements.procurement_activities(id) ON DELETE CASCADE,
  lot_number            INT NOT NULL,
  lot_name              TEXT NOT NULL,
  description           TEXT,
  abc_amount            NUMERIC(15,2) NOT NULL CHECK (abc_amount > 0),
  awarded_supplier_id   UUID REFERENCES procurements.suppliers(id),
  awarded_amount        NUMERIC(15,2),
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','awarded','failed','cancelled')),
  failure_reason        TEXT,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            UUID REFERENCES auth.users(id),
  CONSTRAINT uq_procurement_lot_number UNIQUE (procurement_id, lot_number)
);

CREATE INDEX idx_procurement_lots_procurement ON procurements.procurement_lots(procurement_id);
CREATE INDEX idx_procurement_lots_status      ON procurements.procurement_lots(status);
CREATE INDEX idx_procurement_lots_active      ON procurements.procurement_lots(procurement_id) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_procurement_lots_updated_at
  BEFORE UPDATE ON procurements.procurement_lots
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

ALTER TABLE procurements.procurement_lots ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Add lot_id to bids
-- ============================================================
ALTER TABLE procurements.bids
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES procurements.procurement_lots(id);

CREATE INDEX IF NOT EXISTS idx_bids_lot ON procurements.bids(lot_id);

-- Old uniqueness was effectively (procurement_id, supplier_id) via the
-- application-level check inside record_bid. With lots we want
-- (procurement_id, supplier_id, COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'))
-- to allow the same supplier to bid on multiple lots of the same procurement.
-- This is enforced by record_bid (rewritten below).

-- ============================================================
-- 3. Permissions
-- ============================================================
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('proc.lots.view',   'procurement', 'View execution-level lots on a procurement',     'division'),
  ('proc.lots.manage', 'procurement', 'Create/edit/delete execution-level lots (BAC)',  'division')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  v_pairs TEXT[][] := ARRAY[
    ARRAY['division_admin',  'proc.lots.view'],
    ARRAY['division_admin',  'proc.lots.manage'],
    ARRAY['supply_officer',  'proc.lots.view'],
    ARRAY['supply_officer',  'proc.lots.manage'],
    ARRAY['bac_secretariat', 'proc.lots.view'],
    ARRAY['bac_secretariat', 'proc.lots.manage'],
    ARRAY['bac_chair',       'proc.lots.view'],
    ARRAY['bac_chair',       'proc.lots.manage'],
    ARRAY['bac_member',      'proc.lots.view'],
    ARRAY['hope',            'proc.lots.view'],
    ARRAY['division_chief',  'proc.lots.view'],
    ARRAY['budget_officer',  'proc.lots.view'],
    ARRAY['auditor',         'proc.lots.view'],
    ARRAY['end_user',        'proc.lots.view']
  ];
  v_pair TEXT[];
  v_role_id UUID;
  v_perm_id UUID;
BEGIN
  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    SELECT id INTO v_role_id FROM procurements.roles       WHERE name = v_pair[1];
    SELECT id INTO v_perm_id FROM procurements.permissions WHERE code = v_pair[2];
    IF v_role_id IS NOT NULL AND v_perm_id IS NOT NULL THEN
      INSERT INTO procurements.role_permissions (role_id, permission_id)
      VALUES (v_role_id, v_perm_id)
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 4. RLS policies
-- ============================================================
CREATE POLICY "division_read_procurement_lots" ON procurements.procurement_lots
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND procurement_id IN (
      SELECT id FROM procurements.procurement_activities
       WHERE division_id = procurements.get_user_division_id()
         AND deleted_at  IS NULL
    )
  );

CREATE POLICY "manage_procurement_lots" ON procurements.procurement_lots
  FOR ALL TO authenticated
  USING (
    procurement_id IN (
      SELECT id FROM procurements.procurement_activities
       WHERE division_id = procurements.get_user_division_id()
         AND deleted_at  IS NULL
    )
    AND (
      procurements.has_permission('proc.lots.manage')
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

-- ============================================================
-- 5. Constraint trigger: SUM(lot ABCs) cannot exceed procurement ABC
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.check_procurement_lot_abc_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_proc_abc      NUMERIC;
  v_lots_total    NUMERIC;
BEGIN
  SELECT abc_amount INTO v_proc_abc
    FROM procurements.procurement_activities
   WHERE id = NEW.procurement_id;

  SELECT COALESCE(SUM(abc_amount), 0)
    INTO v_lots_total
    FROM procurements.procurement_lots
   WHERE procurement_id = NEW.procurement_id
     AND deleted_at     IS NULL
     AND id             <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID);

  v_lots_total := v_lots_total + NEW.abc_amount;

  IF v_lots_total > v_proc_abc THEN
    RAISE EXCEPTION 'Sum of lot ABCs (₱%) would exceed the procurement ABC (₱%)',
      v_lots_total, v_proc_abc;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_procurement_lot_abc_total ON procurements.procurement_lots;
CREATE TRIGGER trg_procurement_lot_abc_total
  BEFORE INSERT OR UPDATE OF abc_amount ON procurements.procurement_lots
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION procurements.check_procurement_lot_abc_total();

-- ============================================================
-- 6. Helper: procurement_has_lots(procurement_id)
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.procurement_has_lots(p_procurement_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM procurements.procurement_lots
     WHERE procurement_id = p_procurement_id
       AND deleted_at     IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION procurements.procurement_has_lots(UUID) TO authenticated;

-- ============================================================
-- 7. Rewrite record_bid to support lots
--    - If procurement has lots, lot_id is required and the bid amount
--      is validated against the LOT abc, not the procurement abc.
--    - Same supplier may bid on multiple lots of the same procurement,
--      but only once per (supplier, lot).
--    - If procurement has no lots, behavior is unchanged.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.record_bid(
  p_procurement_id UUID,
  p_supplier_id    UUID,
  p_items          JSONB,
  p_lot_id         UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc        RECORD;
  v_supplier    RECORD;
  v_lot         RECORD;
  v_bid_id      UUID;
  v_bid_amount  NUMERIC := 0;
  v_item        JSONB;
  v_eligibility JSONB;
  v_has_lots    BOOLEAN;
  v_ceiling_amt NUMERIC;
BEGIN
  IF NOT (procurements.has_permission('bid.record') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to record bids';
  END IF;

  SELECT * INTO v_proc
    FROM procurements.procurement_activities
   WHERE id          = p_procurement_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Procurement activity % not found', p_procurement_id;
  END IF;

  IF v_proc.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot record bids on a % procurement', v_proc.status;
  END IF;

  SELECT * INTO v_supplier
    FROM procurements.suppliers
   WHERE id         = p_supplier_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier % not found', p_supplier_id;
  END IF;

  IF v_supplier.status <> 'active' THEN
    RAISE EXCEPTION 'Supplier % is % and cannot submit bids', v_supplier.name, v_supplier.status;
  END IF;

  -- Eligibility documents
  v_eligibility := procurements.supplier_eligibility_check(p_supplier_id, v_proc.procurement_method);
  IF (v_eligibility->>'is_eligible')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION
      'Supplier % is not eligible to bid: missing %, expired %. Verify the required RA 12009 documents on the supplier profile first.',
      v_supplier.name,
      COALESCE((v_eligibility->'missing')::TEXT, '[]'),
      COALESCE((v_eligibility->'expired')::TEXT, '[]');
  END IF;

  -- ---- Lot handling ----
  v_has_lots := procurements.procurement_has_lots(p_procurement_id);

  IF v_has_lots THEN
    IF p_lot_id IS NULL THEN
      RAISE EXCEPTION 'This procurement has lots; lot_id is required when recording a bid';
    END IF;

    SELECT * INTO v_lot
      FROM procurements.procurement_lots
     WHERE id             = p_lot_id
       AND procurement_id = p_procurement_id
       AND deleted_at     IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lot % does not belong to this procurement', p_lot_id;
    END IF;

    IF v_lot.status <> 'open' THEN
      RAISE EXCEPTION 'Cannot bid on lot %; status is %', v_lot.lot_number, v_lot.status;
    END IF;

    v_ceiling_amt := v_lot.abc_amount;

    IF EXISTS (
      SELECT 1 FROM procurements.bids
       WHERE procurement_id = p_procurement_id
         AND supplier_id    = p_supplier_id
         AND lot_id         = p_lot_id
         AND deleted_at     IS NULL
    ) THEN
      RAISE EXCEPTION 'Supplier % already has a bid on lot %', v_supplier.name, v_lot.lot_number;
    END IF;
  ELSE
    -- Lotless: legacy single-bid-per-supplier rule
    IF p_lot_id IS NOT NULL THEN
      RAISE EXCEPTION 'This procurement has no lots; lot_id must be NULL';
    END IF;

    v_ceiling_amt := v_proc.abc_amount;

    IF EXISTS (
      SELECT 1 FROM procurements.bids
       WHERE procurement_id = p_procurement_id
         AND supplier_id    = p_supplier_id
         AND lot_id         IS NULL
         AND deleted_at     IS NULL
    ) THEN
      RAISE EXCEPTION 'Supplier % already has a bid on this procurement', v_supplier.name;
    END IF;
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one bid item is required';
  END IF;

  SELECT COALESCE(SUM((item->>'offered_total_cost')::NUMERIC), 0)
    INTO v_bid_amount
    FROM jsonb_array_elements(p_items) AS item;

  IF v_bid_amount > v_ceiling_amt THEN
    RAISE EXCEPTION 'Bid amount (₱%) exceeds the ABC (₱%) for this %',
      v_bid_amount, v_ceiling_amt, CASE WHEN v_has_lots THEN 'lot' ELSE 'procurement' END;
  END IF;

  INSERT INTO procurements.bids (
    procurement_id, supplier_id, lot_id, bid_amount, bid_date,
    status, office_id
  ) VALUES (
    p_procurement_id, p_supplier_id, p_lot_id, v_bid_amount, NOW(),
    'submitted', v_proc.office_id
  )
  RETURNING id INTO v_bid_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO procurements.bid_items (
      bid_id, pr_item_id, offered_unit_cost, offered_total_cost,
      brand_model, specifications, remarks
    ) VALUES (
      v_bid_id,
      (v_item->>'pr_item_id')::UUID,
      (v_item->>'offered_unit_cost')::NUMERIC,
      (v_item->>'offered_total_cost')::NUMERIC,
      NULLIF(v_item->>'brand_model', ''),
      NULLIF(v_item->>'specifications', ''),
      NULLIF(v_item->>'remarks', '')
    );
  END LOOP;

  RETURN v_bid_id;
END;
$$;
