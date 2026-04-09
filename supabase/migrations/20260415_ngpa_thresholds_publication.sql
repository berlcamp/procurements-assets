-- Phase 7/8 — RA 12009 (NGPA) alignment, batch 1
--
-- Addresses compliance gaps #1–#4 from the alignment review:
--   1. Verifiable thresholds (procurement_method_ceilings extended)
--   2. NGPA vocabulary references (notes/ra_section)
--   3. Posting timeline tracking + enforcement
--   4. Mandatory PhilGEPS reference at appropriate stages
--
-- IMPORTANT: The numeric values seeded here are best-effort and MUST be
-- verified against the latest GPPB Resolution / RA 12009 IRR Schedule of
-- Thresholds before going to production. Treat them as defaults to override.
--
-- Non-destructive: this migration only ADDs columns and updates rows.

-- ============================================================
-- 1. Extend procurement_method_ceilings
-- ============================================================
ALTER TABLE procurements.procurement_method_ceilings
  ADD COLUMN IF NOT EXISTS min_quotations              INT,
  ADD COLUMN IF NOT EXISTS min_posting_days            INT,
  ADD COLUMN IF NOT EXISTS requires_philgeps_publication BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ngpa_section                TEXT,
  ADD COLUMN IF NOT EXISTS display_name                TEXT;

COMMENT ON COLUMN procurements.procurement_method_ceilings.min_quotations IS
  'Minimum number of bids/quotations required before award. RA 12009 IRR — typically 3 for SVP/Shopping, more for Bidding.';
COMMENT ON COLUMN procurements.procurement_method_ceilings.min_posting_days IS
  'Minimum days an opportunity must be posted (PhilGEPS or otherwise) before quotations/bids may be received.';
COMMENT ON COLUMN procurements.procurement_method_ceilings.requires_philgeps_publication IS
  'Whether the opportunity must be published on PhilGEPS before advancing past _sent stages.';
COMMENT ON COLUMN procurements.procurement_method_ceilings.ngpa_section IS
  'RA 12009 / NGPA IRR section reference for this method.';

-- ============================================================
-- 2. Update method ceilings with NGPA-aligned values
--    NOTE: VERIFY THESE NUMBERS against the current GPPB Resolution.
-- ============================================================
UPDATE procurements.procurement_method_ceilings SET
  ceiling_amount                = 1000000.00,
  min_quotations                = 3,
  min_posting_days              = 3,
  requires_philgeps_publication = TRUE,
  ngpa_section                  = 'RA 12009 IRR — Negotiated Procurement (Small Value)',
  display_name                  = 'Small Value Procurement',
  notes                         = 'Best-effort default. Verify ceiling against latest GPPB Resolution.'
WHERE procurement_mode = 'svp';

UPDATE procurements.procurement_method_ceilings SET
  ceiling_amount                = 1000000.00,
  min_quotations                = 3,
  min_posting_days              = 3,
  requires_philgeps_publication = TRUE,
  ngpa_section                  = 'RA 12009 IRR — Shopping (or NGPA Direct Procurement equivalent)',
  display_name                  = 'Shopping',
  notes                         = 'NGPA may consolidate Shopping into Direct Procurement. Verify naming + ceiling.'
WHERE procurement_mode = 'shopping';

UPDATE procurements.procurement_method_ceilings SET
  ceiling_amount                = NULL,
  min_quotations                = 2,
  min_posting_days              = 7,
  requires_philgeps_publication = TRUE,
  ngpa_section                  = 'RA 12009 — Competitive Bidding (default method)',
  display_name                  = 'Competitive Bidding',
  notes                         = 'No ceiling — required for procurements above SVP threshold. Verify min_posting_days.'
WHERE procurement_mode = 'competitive_bidding';

UPDATE procurements.procurement_method_ceilings SET
  min_quotations                = 1,
  requires_philgeps_publication = FALSE,
  ngpa_section                  = 'RA 12009 IRR — Direct Contracting',
  display_name                  = 'Direct Contracting',
  notes                         = 'Conditions-based; no ceiling. PhilGEPS posting may be waived. Verify.'
WHERE procurement_mode = 'direct_contracting';

UPDATE procurements.procurement_method_ceilings SET
  min_quotations                = 1,
  requires_philgeps_publication = FALSE,
  ngpa_section                  = 'RA 12009 IRR — Repeat Order',
  display_name                  = 'Repeat Order',
  notes                         = 'Repeat of a previously awarded contract; conditions apply. Verify.'
WHERE procurement_mode = 'repeat_order';

UPDATE procurements.procurement_method_ceilings SET
  min_quotations                = 1,
  requires_philgeps_publication = FALSE,
  ngpa_section                  = 'RA 12009 IRR — Negotiated (Emergency Cases)',
  display_name                  = 'Emergency Purchase',
  notes                         = 'Emergency conditions per IRR. Posting timelines may be relaxed. Verify.'
WHERE procurement_mode = 'emergency';

UPDATE procurements.procurement_method_ceilings SET
  min_quotations                = 1,
  requires_philgeps_publication = FALSE,
  ngpa_section                  = 'RA 12009 IRR — Negotiated Procurement (catch-all)',
  display_name                  = 'Negotiated Procurement',
  notes                         = 'Umbrella for SVP and other negotiated sub-modalities. Verify.'
WHERE procurement_mode = 'negotiated';

UPDATE procurements.procurement_method_ceilings SET
  min_quotations                = 1,
  requires_philgeps_publication = FALSE,
  ngpa_section                  = 'RA 12009 IRR — Agency-to-Agency',
  display_name                  = 'Agency-to-Agency',
  notes                         = 'Inter-agency arrangement; no bidding required.'
WHERE procurement_mode = 'agency_to_agency';

-- ============================================================
-- 3. Add posting timeline columns to procurement_activities
-- ============================================================
ALTER TABLE procurements.procurement_activities
  ADD COLUMN IF NOT EXISTS posting_date            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submission_deadline     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posting_required_days   INT,
  ADD COLUMN IF NOT EXISTS philgeps_published_at   TIMESTAMPTZ;

COMMENT ON COLUMN procurements.procurement_activities.posting_date IS
  'When the RFQ/canvass was posted (to PhilGEPS or otherwise). Set automatically when stage advances to *_sent.';
COMMENT ON COLUMN procurements.procurement_activities.submission_deadline IS
  'Earliest moment quotations/bids may be received. Computed from posting_date + posting_required_days.';
COMMENT ON COLUMN procurements.procurement_activities.posting_required_days IS
  'Snapshot of the method ceiling row''s min_posting_days at the time the activity was created.';
COMMENT ON COLUMN procurements.procurement_activities.philgeps_published_at IS
  'When the procurement was published on PhilGEPS. Required for methods with requires_philgeps_publication=true.';

-- ============================================================
-- 4. On activity creation, snapshot posting_required_days from ceilings
--    (Trigger fires after the create_procurement_activity insert.)
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.snapshot_procurement_posting_requirements()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_days INT;
BEGIN
  IF NEW.posting_required_days IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT min_posting_days INTO v_days
    FROM procurements.procurement_method_ceilings
   WHERE procurement_mode = NEW.procurement_method;

  IF v_days IS NOT NULL THEN
    NEW.posting_required_days := v_days;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_procurement_posting_snapshot ON procurements.procurement_activities;
CREATE TRIGGER trg_procurement_posting_snapshot
  BEFORE INSERT ON procurements.procurement_activities
  FOR EACH ROW
  EXECUTE FUNCTION procurements.snapshot_procurement_posting_requirements();

-- ============================================================
-- 5. Rewrite advance_procurement_stage with NGPA enforcement
--    - When advancing INTO an *_sent stage, stamp posting_date and
--      compute submission_deadline.
--    - Block advancing PAST _sent stages unless philgeps_reference is
--      set (when method requires it).
--    - Block advancing PAST _received stages unless submission_deadline
--      has passed (or a justification note is recorded).
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.advance_procurement_stage(
  p_procurement_id UUID,
  p_next_stage     TEXT,
  p_notes          TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc          RECORD;
  v_ceiling       RECORD;
  v_valid_stages  TEXT[];
  v_current_idx   INTEGER;
  v_next_idx      INTEGER;
  v_deadline      TIMESTAMPTZ;
BEGIN
  IF NOT (procurements.has_permission('proc.advance') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to advance procurement stage';
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
    RAISE EXCEPTION 'Cannot advance stages on a % procurement', v_proc.status;
  END IF;

  -- Look up the method's posting + publication requirements
  SELECT * INTO v_ceiling
    FROM procurements.procurement_method_ceilings
   WHERE procurement_mode = v_proc.procurement_method;

  -- Define valid stage sequences per method
  CASE v_proc.procurement_method
    WHEN 'svp' THEN
      v_valid_stages := ARRAY[
        'created', 'rfq_preparation', 'rfq_sent', 'quotations_received',
        'evaluation', 'abstract_prepared', 'award_recommended', 'award_approved', 'completed'
      ];
    WHEN 'shopping' THEN
      v_valid_stages := ARRAY[
        'created', 'canvass_preparation', 'canvass_sent', 'canvass_received',
        'comparison', 'award_recommended', 'award_approved', 'completed'
      ];
    ELSE
      RAISE EXCEPTION 'Stage advancement not yet implemented for method: %', v_proc.procurement_method;
  END CASE;

  SELECT array_position(v_valid_stages, v_proc.current_stage) INTO v_current_idx;
  SELECT array_position(v_valid_stages, p_next_stage) INTO v_next_idx;

  IF v_current_idx IS NULL THEN
    RAISE EXCEPTION 'Current stage % is not in valid stage list for method %',
      v_proc.current_stage, v_proc.procurement_method;
  END IF;

  IF v_next_idx IS NULL THEN
    RAISE EXCEPTION 'Target stage % is not valid for method %',
      p_next_stage, v_proc.procurement_method;
  END IF;

  IF v_next_idx <> v_current_idx + 1 THEN
    RAISE EXCEPTION 'Cannot skip stages. Current: %, Next expected: %, Got: %',
      v_proc.current_stage,
      v_valid_stages[v_current_idx + 1],
      p_next_stage;
  END IF;

  -- ------------------------------------------------------------
  -- NGPA enforcement
  -- ------------------------------------------------------------

  -- (a) When entering rfq_sent / canvass_sent: stamp posting_date and
  --     compute submission_deadline. Require PhilGEPS reference if the
  --     method demands publication.
  IF p_next_stage IN ('rfq_sent', 'canvass_sent') THEN
    IF v_ceiling.requires_philgeps_publication
       AND COALESCE(NULLIF(TRIM(v_proc.philgeps_reference), ''), NULL) IS NULL
    THEN
      RAISE EXCEPTION 'PhilGEPS reference is required before advancing to %. Set procurement_activities.philgeps_reference first.',
        p_next_stage;
    END IF;

    v_deadline := NOW() + (COALESCE(v_proc.posting_required_days, v_ceiling.min_posting_days, 0) || ' days')::INTERVAL;

    UPDATE procurements.procurement_activities
       SET posting_date          = COALESCE(posting_date, NOW()),
           submission_deadline   = COALESCE(submission_deadline, v_deadline),
           philgeps_published_at = CASE
             WHEN v_ceiling.requires_philgeps_publication
                  AND philgeps_published_at IS NULL THEN NOW()
             ELSE philgeps_published_at
           END
     WHERE id = p_procurement_id;
  END IF;

  -- (b) When entering quotations_received / canvass_received: enforce
  --     that the submission_deadline has passed (unless overridden via notes).
  IF p_next_stage IN ('quotations_received', 'canvass_received') THEN
    IF v_proc.submission_deadline IS NOT NULL
       AND NOW() < v_proc.submission_deadline
       AND COALESCE(LENGTH(TRIM(p_notes)), 0) < 10
    THEN
      RAISE EXCEPTION 'Submission deadline (%) has not yet passed. Provide a justification of at least 10 characters in notes to proceed early.',
        v_proc.submission_deadline;
    END IF;
  END IF;

  -- ------------------------------------------------------------
  -- Apply the stage transition
  -- ------------------------------------------------------------

  UPDATE procurements.procurement_stages
     SET status       = 'completed',
         completed_at = NOW(),
         completed_by = auth.uid(),
         notes        = COALESCE(p_notes, notes)
   WHERE procurement_id = p_procurement_id
     AND status          = 'current';

  INSERT INTO procurements.procurement_stages (procurement_id, stage, status, started_at, office_id)
  VALUES (p_procurement_id, p_next_stage, 'current', NOW(), v_proc.office_id);

  UPDATE procurements.procurement_activities
     SET current_stage = p_next_stage,
         updated_at    = NOW()
   WHERE id = p_procurement_id;

  IF p_next_stage = 'completed' THEN
    UPDATE procurements.procurement_activities
       SET status     = 'completed',
           updated_at = NOW()
     WHERE id = p_procurement_id;

    UPDATE procurements.purchase_requests
       SET status     = 'completed',
           updated_at = NOW()
     WHERE id = v_proc.purchase_request_id;
  END IF;
END;
$$;

-- ============================================================
-- 6. Backfill posting_required_days for existing in-flight activities
--    (so old rows don't trip the deadline check on next advance)
-- ============================================================
UPDATE procurements.procurement_activities pa
   SET posting_required_days = c.min_posting_days
  FROM procurements.procurement_method_ceilings c
 WHERE pa.posting_required_days IS NULL
   AND c.procurement_mode = pa.procurement_method
   AND c.min_posting_days IS NOT NULL;

-- ============================================================
-- 7. Verification queries (run manually after applying)
-- ============================================================
-- SELECT procurement_mode, ceiling_amount, min_quotations, min_posting_days,
--        requires_philgeps_publication, ngpa_section
--   FROM procurements.procurement_method_ceilings
--  ORDER BY procurement_mode;
--
-- SELECT id, procurement_number, procurement_method, current_stage,
--        posting_date, submission_deadline, posting_required_days,
--        philgeps_reference, philgeps_published_at
--   FROM procurements.procurement_activities
--  WHERE deleted_at IS NULL
--  ORDER BY created_at DESC
--  LIMIT 10;
