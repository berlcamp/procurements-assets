-- =============================================================================
-- PPMP Supporting Document Uploads
-- =============================================================================
-- Separate private bucket for PPMP lot supporting documents.
-- Upload is allowed for users with ppmp.edit (end_user, section_chief,
-- division_admin, etc.) — distinct from proc.manage (BAC only) used by the
-- procurement-documents bucket.
--
-- Path convention:  {division_id}/ppmp/{project_id}/{epoch_ms}.{ext}
-- First folder segment must match procurements.get_user_division_id().
-- =============================================================================

-- ============================================================
-- 1. Bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ppmp-documents',
  'ppmp-documents',
  FALSE,
  52428800,  -- 50 MB per file
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit  = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 2. Storage RLS policies
--    Path: {division_id}/ppmp/{project_id}/{filename}
--    First folder segment must equal caller's division.
--    Write requires ppmp.edit permission.
-- ============================================================

DROP POLICY IF EXISTS "ppmp_docs_division_read"   ON storage.objects;
DROP POLICY IF EXISTS "ppmp_docs_editor_insert"   ON storage.objects;
DROP POLICY IF EXISTS "ppmp_docs_editor_update"   ON storage.objects;
DROP POLICY IF EXISTS "ppmp_docs_editor_delete"   ON storage.objects;

-- Any authenticated division member may download their division's PPMP docs
CREATE POLICY "ppmp_docs_division_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'ppmp-documents'
    AND (storage.foldername(name))[1] = procurements.get_user_division_id()::text
  );

-- Users with ppmp.edit may upload into their own division's folder
CREATE POLICY "ppmp_docs_editor_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ppmp-documents'
    AND (storage.foldername(name))[1] = procurements.get_user_division_id()::text
    AND procurements.has_permission('ppmp.edit')
  );

CREATE POLICY "ppmp_docs_editor_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'ppmp-documents'
    AND (storage.foldername(name))[1] = procurements.get_user_division_id()::text
    AND procurements.has_permission('ppmp.edit')
  );

CREATE POLICY "ppmp_docs_editor_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'ppmp-documents'
    AND (storage.foldername(name))[1] = procurements.get_user_division_id()::text
    AND procurements.has_permission('ppmp.edit')
  );
