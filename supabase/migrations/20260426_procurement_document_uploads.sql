-- =============================================================================
-- Phase 9.1 — Procurement document uploads
--
-- Adds real file-upload support for the four required procurement
-- documents and wires stage-transition gates so a stage cannot be left
-- until its document has been uploaded.
--
--   * BAC Resolution      — uploaded at bac_resolution      stage
--                           (gate already exists from migration 20260425)
--   * Notice of Award     — uploaded at noa_issued          stage
--   * Signed Contract     — uploaded at contract_signing    stage
--   * Notice to Proceed   — uploaded at ntp_issued          stage
--
-- Files live in a PRIVATE Supabase Storage bucket `procurement-documents`
-- with RLS policies that restrict access to the uploader's division.
-- Paths follow the convention:
--
--   {division_id}/{procurement_id}/{doc_type}-{epoch_ms}.{ext}
--
-- The first folder segment is the division UUID — storage RLS checks it
-- against procurements.get_user_division_id(). Only roles carrying
-- `proc.manage` (BAC Secretariat + division_admin) may write/delete.
-- =============================================================================

-- ============================================================
-- 1. NOA / signed contract / NTP file columns
-- ============================================================
ALTER TABLE procurements.procurement_activities
  ADD COLUMN IF NOT EXISTS noa_file_url                  TEXT,
  ADD COLUMN IF NOT EXISTS noa_issued_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS noa_uploaded_by               UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS signed_contract_file_url      TEXT,
  ADD COLUMN IF NOT EXISTS contract_signed_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_contract_uploaded_by   UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS ntp_file_url                  TEXT,
  ADD COLUMN IF NOT EXISTS ntp_issued_at                 TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ntp_uploaded_by               UUID REFERENCES auth.users(id);

-- ============================================================
-- 2. Generic RPC: set_procurement_document_url
--    Used after a client-side upload to persist the storage path into
--    the appropriate column. Rejects unknown doc types.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.set_procurement_document_url(
  p_procurement_id UUID,
  p_doc_type       TEXT,
  p_file_url       TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc RECORD;
BEGIN
  IF NOT procurements.has_permission('proc.manage') THEN
    RAISE EXCEPTION 'Insufficient permissions: only the BAC Secretariat can upload procurement documents';
  END IF;

  IF COALESCE(LENGTH(TRIM(p_file_url)), 0) = 0 THEN
    RAISE EXCEPTION 'File path is required';
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
    RAISE EXCEPTION 'Cannot upload documents to a % procurement', v_proc.status;
  END IF;

  IF p_doc_type = 'noa' THEN
    IF v_proc.current_stage <> 'noa_issued' THEN
      RAISE EXCEPTION 'Notice of Award can only be uploaded while the procurement is at the noa_issued stage (current: %)', v_proc.current_stage;
    END IF;

    UPDATE procurements.procurement_activities
       SET noa_file_url    = TRIM(p_file_url),
           noa_issued_at   = COALESCE(noa_issued_at, NOW()),
           noa_uploaded_by = auth.uid(),
           updated_at      = NOW()
     WHERE id = p_procurement_id;

  ELSIF p_doc_type = 'signed_contract' THEN
    IF v_proc.current_stage <> 'contract_signing' THEN
      RAISE EXCEPTION 'Signed Contract can only be uploaded while the procurement is at the contract_signing stage (current: %)', v_proc.current_stage;
    END IF;

    UPDATE procurements.procurement_activities
       SET signed_contract_file_url    = TRIM(p_file_url),
           contract_signed_at          = COALESCE(contract_signed_at, NOW()),
           signed_contract_uploaded_by = auth.uid(),
           updated_at                  = NOW()
     WHERE id = p_procurement_id;

  ELSIF p_doc_type = 'ntp' THEN
    IF v_proc.current_stage <> 'ntp_issued' THEN
      RAISE EXCEPTION 'Notice to Proceed can only be uploaded while the procurement is at the ntp_issued stage (current: %)', v_proc.current_stage;
    END IF;

    UPDATE procurements.procurement_activities
       SET ntp_file_url    = TRIM(p_file_url),
           ntp_issued_at   = COALESCE(ntp_issued_at, NOW()),
           ntp_uploaded_by = auth.uid(),
           updated_at      = NOW()
     WHERE id = p_procurement_id;

  ELSIF p_doc_type = 'bac_resolution' THEN
    IF v_proc.current_stage <> 'bac_resolution' THEN
      RAISE EXCEPTION 'BAC Resolution can only be uploaded while the procurement is at the bac_resolution stage (current: %)', v_proc.current_stage;
    END IF;

    UPDATE procurements.procurement_activities
       SET bac_resolution_file_url    = TRIM(p_file_url),
           bac_resolution_uploaded_at = NOW(),
           bac_resolution_uploaded_by = auth.uid(),
           updated_at                 = NOW()
     WHERE id = p_procurement_id;

  ELSE
    RAISE EXCEPTION 'Unknown procurement document type: %', p_doc_type;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.set_procurement_document_url(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- 3. Stage-gate triggers — enforce file-on-record before leaving each stage
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.enforce_stage_document_gates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Leaving noa_issued → contract_signing requires the NOA PDF on file
  IF OLD.current_stage = 'noa_issued' AND NEW.current_stage = 'contract_signing' THEN
    IF NEW.noa_file_url IS NULL OR LENGTH(TRIM(NEW.noa_file_url)) = 0 THEN
      RAISE EXCEPTION 'Notice of Award file must be uploaded before advancing to Contract Signing. Ask the BAC Secretariat to upload the signed NOA first.';
    END IF;
  END IF;

  -- Leaving contract_signing → ntp_issued requires the signed contract on file
  IF OLD.current_stage = 'contract_signing' AND NEW.current_stage = 'ntp_issued' THEN
    IF NEW.signed_contract_file_url IS NULL OR LENGTH(TRIM(NEW.signed_contract_file_url)) = 0 THEN
      RAISE EXCEPTION 'Signed Contract file must be uploaded before advancing to NTP Issued. Ask the BAC Secretariat to upload the signed contract first.';
    END IF;
  END IF;

  -- Leaving ntp_issued → completed requires the NTP PDF on file
  IF OLD.current_stage = 'ntp_issued' AND NEW.current_stage = 'completed' THEN
    IF NEW.ntp_file_url IS NULL OR LENGTH(TRIM(NEW.ntp_file_url)) = 0 THEN
      RAISE EXCEPTION 'Notice to Proceed file must be uploaded before marking the procurement as completed. Ask the BAC Secretariat to upload the signed NTP first.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_stage_document_gates
  ON procurements.procurement_activities;

CREATE TRIGGER trg_enforce_stage_document_gates
  BEFORE UPDATE OF current_stage ON procurements.procurement_activities
  FOR EACH ROW
  EXECUTE FUNCTION procurements.enforce_stage_document_gates();

-- ============================================================
-- 4. Supabase Storage bucket: procurement-documents (private)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'procurement-documents',
  'procurement-documents',
  FALSE,
  52428800,  -- 50 MB per file
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 5. Storage RLS policies for procurement-documents
--    Path convention: {division_id}/{procurement_id}/{doc_type}-{ts}.{ext}
--    The first folder segment must match the caller's division.
--    Write/delete require proc.manage (Secretariat + division_admin).
-- ============================================================

-- Drop any prior versions (idempotent re-run)
DROP POLICY IF EXISTS "procurement_docs_division_read"
  ON storage.objects;
DROP POLICY IF EXISTS "procurement_docs_secretariat_insert"
  ON storage.objects;
DROP POLICY IF EXISTS "procurement_docs_secretariat_update"
  ON storage.objects;
DROP POLICY IF EXISTS "procurement_docs_secretariat_delete"
  ON storage.objects;

-- Any authenticated user in the same division may read procurement
-- documents for their division. RLS on procurement_activities separately
-- enforces division scoping on the DB rows.
CREATE POLICY "procurement_docs_division_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'procurement-documents'
    AND (storage.foldername(name))[1] = procurements.get_user_division_id()::text
  );

-- Only users with proc.manage (Secretariat / division_admin) may upload.
-- They may only upload into their own division's folder.
CREATE POLICY "procurement_docs_secretariat_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'procurement-documents'
    AND (storage.foldername(name))[1] = procurements.get_user_division_id()::text
    AND procurements.has_permission('proc.manage')
  );

CREATE POLICY "procurement_docs_secretariat_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'procurement-documents'
    AND (storage.foldername(name))[1] = procurements.get_user_division_id()::text
    AND procurements.has_permission('proc.manage')
  )
  WITH CHECK (
    bucket_id = 'procurement-documents'
    AND (storage.foldername(name))[1] = procurements.get_user_division_id()::text
    AND procurements.has_permission('proc.manage')
  );

CREATE POLICY "procurement_docs_secretariat_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'procurement-documents'
    AND (storage.foldername(name))[1] = procurements.get_user_division_id()::text
    AND procurements.has_permission('proc.manage')
  );
