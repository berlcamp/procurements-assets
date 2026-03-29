-- Phase 3: documents table
CREATE TABLE IF NOT EXISTS procurements.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_type TEXT NOT NULL,
  reference_id UUID NOT NULL,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  office_id UUID REFERENCES procurements.offices(id),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_ref ON procurements.documents(reference_type, reference_id);
CREATE INDEX idx_documents_type ON procurements.documents(document_type);
CREATE INDEX idx_documents_uploader ON procurements.documents(uploaded_by);
CREATE INDEX idx_documents_active ON procurements.documents(id) WHERE deleted_at IS NULL;
