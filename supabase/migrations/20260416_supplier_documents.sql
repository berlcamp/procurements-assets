-- Phase 8.5 Step 1 — Supplier eligibility documents
--
-- Adds the data model for tracking RA 12009 eligibility documents on
-- suppliers (PhilGEPS Cert, Business Permit, BIR Cert, Tax Clearance, AFS,
-- ITR, Statement of Ongoing Contracts, NFCC). Wires the gating into
-- record_bid so a bidder cannot record a quotation if any required
-- document is missing or expired.
--
-- Non-destructive. Document storage is left as a URL field for now —
-- file uploads can be added later via Supabase Storage without schema
-- changes.

-- ============================================================
-- 1. Lookup table: supplier_document_types
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.supplier_document_types (
  code                  TEXT PRIMARY KEY,
  display_name          TEXT NOT NULL,
  required_for_bidding  BOOLEAN NOT NULL DEFAULT TRUE,
  required_for_svp      BOOLEAN NOT NULL DEFAULT TRUE,
  ngpa_section          TEXT,
  notes                 TEXT,
  sort_order            INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO procurements.supplier_document_types
  (code, display_name, required_for_bidding, required_for_svp, ngpa_section, sort_order, notes)
VALUES
  ('PHILGEPS_REG',    'PhilGEPS Certificate of Registration', TRUE,  TRUE,  'RA 12009 Sec 8.5.2',  10, 'Mandatory for ALL suppliers participating in any procurement'),
  ('BUSINESS_PERMIT', 'Mayor''s / Business Permit',           TRUE,  TRUE,  'RA 12009 IRR Sec 23', 20, 'Issued by LGU where the business is located'),
  ('BIR_CERT',        'BIR Certificate of Registration (2303)', TRUE, TRUE, 'RA 12009 IRR Sec 23', 30, 'Bureau of Internal Revenue Form 2303'),
  ('TAX_CLEARANCE',   'BIR Tax Clearance for Bidding',        TRUE,  FALSE, 'RA 12009 IRR Sec 23', 40, 'Required for Competitive Bidding; some SVP exceptions'),
  ('AFS',             'Audited Financial Statements (latest)', TRUE, FALSE, 'RA 12009 IRR Sec 23', 50, 'Required for Competitive Bidding above threshold'),
  ('ITR',             'Latest Income Tax Return',              TRUE, FALSE, 'RA 12009 IRR Sec 23', 60, 'Required for Competitive Bidding'),
  ('CONTRACTS_LIST',  'Statement of Ongoing & Completed Contracts', TRUE, FALSE, 'RA 12009 IRR Sec 23', 70, 'Required for Competitive Bidding (goods/infra)'),
  ('NFCC',            'Net Financial Contracting Capacity',    TRUE, FALSE, 'RA 12009 IRR Sec 23', 80, 'Computed financial capacity; required for Competitive Bidding')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE procurements.supplier_document_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_supplier_document_types" ON procurements.supplier_document_types
  FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "super_admin_manage_supplier_document_types" ON procurements.supplier_document_types
  FOR ALL TO authenticated
  USING (platform.is_super_admin())
  WITH CHECK (platform.is_super_admin());

-- ============================================================
-- 2. supplier_documents table
-- ============================================================
CREATE TABLE IF NOT EXISTS procurements.supplier_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id         UUID NOT NULL REFERENCES procurements.suppliers(id) ON DELETE CASCADE,
  document_type       TEXT NOT NULL REFERENCES procurements.supplier_document_types(code),
  document_number     TEXT,
  document_url        TEXT,
  issuing_authority   TEXT,
  issue_date          DATE,
  expiry_date         DATE,
  verified_by         UUID REFERENCES auth.users(id),
  verified_at         TIMESTAMPTZ,
  notes               TEXT,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_supplier_documents_supplier ON procurements.supplier_documents(supplier_id);
CREATE INDEX idx_supplier_documents_type     ON procurements.supplier_documents(document_type);
CREATE INDEX idx_supplier_documents_expiry   ON procurements.supplier_documents(expiry_date);
CREATE INDEX idx_supplier_documents_active   ON procurements.supplier_documents(supplier_id) WHERE deleted_at IS NULL;

-- updated_at trigger
CREATE TRIGGER trg_supplier_documents_updated_at
  BEFORE UPDATE ON procurements.supplier_documents
  FOR EACH ROW EXECUTE FUNCTION procurements.set_updated_at();

ALTER TABLE procurements.supplier_documents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. Permissions
-- ============================================================
INSERT INTO procurements.permissions (code, module, description, scope) VALUES
  ('supplier.docs.view',   'procurement', 'View supplier eligibility documents', 'division'),
  ('supplier.docs.manage', 'procurement', 'Add/edit/delete supplier eligibility documents', 'division'),
  ('supplier.docs.verify', 'procurement', 'Verify supplier eligibility documents (BAC Secretariat / BAC Chair)', 'division')
ON CONFLICT (code) DO NOTHING;

-- Seed role assignments
DO $$
DECLARE
  v_pairs TEXT[][] := ARRAY[
    ARRAY['division_admin',  'supplier.docs.view'],
    ARRAY['division_admin',  'supplier.docs.manage'],
    ARRAY['division_admin',  'supplier.docs.verify'],
    ARRAY['supply_officer',  'supplier.docs.view'],
    ARRAY['supply_officer',  'supplier.docs.manage'],
    ARRAY['bac_secretariat', 'supplier.docs.view'],
    ARRAY['bac_secretariat', 'supplier.docs.manage'],
    ARRAY['bac_secretariat', 'supplier.docs.verify'],
    ARRAY['bac_chair',       'supplier.docs.view'],
    ARRAY['bac_chair',       'supplier.docs.verify'],
    ARRAY['bac_member',      'supplier.docs.view'],
    ARRAY['hope',            'supplier.docs.view'],
    ARRAY['division_chief',  'supplier.docs.view'],
    ARRAY['budget_officer',  'supplier.docs.view'],
    ARRAY['auditor',         'supplier.docs.view']
  ];
  v_pair TEXT[];
  v_role_id UUID;
  v_perm_id UUID;
BEGIN
  FOREACH v_pair SLICE 1 IN ARRAY v_pairs LOOP
    SELECT id INTO v_role_id FROM procurements.roles WHERE name = v_pair[1];
    SELECT id INTO v_perm_id FROM procurements.permissions WHERE code = v_pair[2];
    IF v_role_id IS NOT NULL AND v_perm_id IS NOT NULL THEN
      INSERT INTO procurements.role_permissions (role_id, permission_id)
      VALUES (v_role_id, v_perm_id)
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 4. RLS policies on supplier_documents
-- ============================================================

CREATE POLICY "division_read_supplier_documents" ON procurements.supplier_documents
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND supplier_id IN (
      SELECT id FROM procurements.suppliers
       WHERE division_id = procurements.get_user_division_id()
         AND deleted_at  IS NULL
    )
  );

CREATE POLICY "manage_supplier_documents" ON procurements.supplier_documents
  FOR ALL TO authenticated
  USING (
    supplier_id IN (
      SELECT id FROM procurements.suppliers
       WHERE division_id = procurements.get_user_division_id()
         AND deleted_at  IS NULL
    )
    AND (
      procurements.has_permission('supplier.docs.manage')
      OR procurements.has_permission('supplier.docs.verify')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    supplier_id IN (
      SELECT id FROM procurements.suppliers
       WHERE division_id = procurements.get_user_division_id()
    )
  );

-- ============================================================
-- 5. Helper: supplier_eligibility_check(supplier_id, method)
--    Returns a JSON object describing missing or expired required docs.
--    { is_eligible, missing[], expired[] }
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.supplier_eligibility_check(
  p_supplier_id UUID,
  p_method      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
DECLARE
  v_required_col   TEXT;
  v_missing        TEXT[] := ARRAY[]::TEXT[];
  v_expired        TEXT[] := ARRAY[]::TEXT[];
  v_doc_type       RECORD;
  v_doc            RECORD;
BEGIN
  -- Determine which required-flag column to check
  IF p_method IN ('competitive_bidding') THEN
    v_required_col := 'bidding';
  ELSE
    v_required_col := 'svp';
  END IF;

  -- Iterate the required document types for this method
  FOR v_doc_type IN
    SELECT code, display_name
      FROM procurements.supplier_document_types
     WHERE (v_required_col = 'bidding' AND required_for_bidding)
        OR (v_required_col = 'svp'     AND required_for_svp)
  LOOP
    -- Most recent verified, non-deleted doc of this type
    SELECT * INTO v_doc
      FROM procurements.supplier_documents
     WHERE supplier_id   = p_supplier_id
       AND document_type = v_doc_type.code
       AND deleted_at    IS NULL
       AND verified_at   IS NOT NULL
     ORDER BY COALESCE(expiry_date, '9999-12-31'::DATE) DESC, issue_date DESC NULLS LAST
     LIMIT 1;

    IF NOT FOUND THEN
      v_missing := array_append(v_missing, v_doc_type.code);
    ELSIF v_doc.expiry_date IS NOT NULL AND v_doc.expiry_date < CURRENT_DATE THEN
      v_expired := array_append(v_expired, v_doc_type.code);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'is_eligible', (array_length(v_missing, 1) IS NULL AND array_length(v_expired, 1) IS NULL),
    'missing',     v_missing,
    'expired',     v_expired
  );
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.supplier_eligibility_check(UUID, TEXT) TO authenticated;

-- ============================================================
-- 6. Update record_bid to enforce eligibility before recording
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.record_bid(
  p_procurement_id UUID,
  p_supplier_id    UUID,
  p_items          JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc        RECORD;
  v_supplier    RECORD;
  v_bid_id      UUID;
  v_bid_amount  NUMERIC := 0;
  v_item        JSONB;
  v_eligibility JSONB;
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

  -- ---- NEW: enforce eligibility documents ----
  v_eligibility := procurements.supplier_eligibility_check(p_supplier_id, v_proc.procurement_method);
  IF (v_eligibility->>'is_eligible')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION
      'Supplier % is not eligible to bid: missing %, expired %. Verify the required RA 12009 documents on the supplier profile first.',
      v_supplier.name,
      COALESCE((v_eligibility->'missing')::TEXT, '[]'),
      COALESCE((v_eligibility->'expired')::TEXT, '[]');
  END IF;
  -- ---- end eligibility gate ----

  IF EXISTS (
    SELECT 1 FROM procurements.bids
    WHERE procurement_id = p_procurement_id
      AND supplier_id    = p_supplier_id
      AND deleted_at     IS NULL
  ) THEN
    RAISE EXCEPTION 'Supplier % already has a bid on this procurement', v_supplier.name;
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one bid item is required';
  END IF;

  SELECT COALESCE(SUM((item->>'offered_total_cost')::NUMERIC), 0)
    INTO v_bid_amount
    FROM jsonb_array_elements(p_items) AS item;

  IF v_bid_amount > v_proc.abc_amount THEN
    RAISE EXCEPTION 'Bid amount (₱%) exceeds the Approved Budget for the Contract (₱%)',
      v_bid_amount, v_proc.abc_amount;
  END IF;

  INSERT INTO procurements.bids (
    procurement_id, supplier_id, bid_amount, bid_date,
    status, office_id
  ) VALUES (
    p_procurement_id, p_supplier_id, v_bid_amount, NOW(),
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
