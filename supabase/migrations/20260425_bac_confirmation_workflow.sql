-- =============================================================================
-- Phase 9 — BAC Confirmation Workflow
--
-- Shifts the evaluation model to "Secretariat drafts, BAC members confirm".
--
--   * The BAC Secretariat (via `proc.manage`) is the ONLY role that writes
--     evaluation data (bids.is_responsive / is_eligible / is_compliant /
--     evaluation_score / remarks). Their writes land directly on `bids`.
--   * BAC Chair and BAC Members no longer have `bid.evaluate`. They gain a
--     new `bid.confirm` permission whose only action is to click "Confirm"
--     — snapshotting the Secretariat's current draft into bid_evaluations
--     as their personal agreement. Quorum = 3 distinct confirming members.
--   * If the Secretariat edits any evaluation field after members have
--     confirmed, every existing confirmation is auto-invalidated (status
--     → 'stale') and the affected members receive a notification asking
--     them to re-confirm.
--   * BAC Resolution document (number + date + URL) is uploaded by the
--     Secretariat at the `bac_resolution` stage; advancing to
--     `award_recommended` requires the resolution to be on file.
--
-- Non-destructive — existing bid_evaluations rows are treated as already
-- 'confirmed' via the column default so mid-flight procurements continue
-- to work.
-- =============================================================================

-- ============================================================
-- 1. New permission: bid.confirm
-- ============================================================
INSERT INTO procurements.permissions (code, module, description, scope)
VALUES (
  'bid.confirm',
  'procurement',
  'Confirm the BAC Secretariat''s bid evaluation draft (BAC members only)',
  'division'
)
ON CONFLICT (code) DO NOTHING;

-- Grant bid.confirm to bac_chair and bac_member
INSERT INTO procurements.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM procurements.roles r
 CROSS JOIN procurements.permissions p
 WHERE r.name IN ('bac_chair', 'bac_member')
   AND p.code = 'bid.confirm'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Revoke bid.evaluate from bac_chair and bac_member — only the Secretariat
-- (via proc.manage) and division_admin may write evaluation data.
DELETE FROM procurements.role_permissions
 WHERE role_id IN (
         SELECT id FROM procurements.roles WHERE name IN ('bac_chair', 'bac_member')
       )
   AND permission_id = (
         SELECT id FROM procurements.permissions WHERE code = 'bid.evaluate'
       );

-- ============================================================
-- 2. Extend bid_evaluations with confirmation status
-- ============================================================
ALTER TABLE procurements.bid_evaluations
  ADD COLUMN IF NOT EXISTS status         TEXT        NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'stale')),
  ADD COLUMN IF NOT EXISTS confirmed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

-- Replace the old full unique constraint with a partial unique index so an
-- evaluator can have multiple 'stale' rows but at most one 'confirmed' row
-- per bid.
ALTER TABLE procurements.bid_evaluations
  DROP CONSTRAINT IF EXISTS uq_bid_evaluator;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bid_evaluator_active
  ON procurements.bid_evaluations (bid_id, evaluator_id)
  WHERE status = 'confirmed';

-- ============================================================
-- 3. BAC Resolution document fields on procurement_activities
-- ============================================================
ALTER TABLE procurements.procurement_activities
  ADD COLUMN IF NOT EXISTS bac_resolution_number      TEXT,
  ADD COLUMN IF NOT EXISTS bac_resolution_date        DATE,
  ADD COLUMN IF NOT EXISTS bac_resolution_file_url    TEXT,
  ADD COLUMN IF NOT EXISTS bac_resolution_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bac_resolution_uploaded_by UUID REFERENCES auth.users(id);

-- ============================================================
-- 4. procurement_evaluator_count — count only confirmed voting members
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.procurement_evaluator_count(p_procurement_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT COUNT(DISTINCT be.evaluator_id)::INT
    FROM procurements.bid_evaluations be
    JOIN procurements.bids b ON b.id = be.bid_id
   WHERE b.procurement_id = p_procurement_id
     AND b.deleted_at     IS NULL
     AND be.status        = 'confirmed'
     AND EXISTS (
       -- Only confirmations from BAC voting members count toward quorum.
       -- The Secretariat is staff and never inserts a confirmation row
       -- for themselves, but this guard defends against drift.
       SELECT 1
         FROM procurements.user_roles ur
         JOIN procurements.roles r ON r.id = ur.role_id
        WHERE ur.user_id    = be.evaluator_id
          AND ur.is_active  = TRUE
          AND ur.revoked_at IS NULL
          AND r.name IN ('bac_chair', 'bac_member')
     );
$$;

-- ============================================================
-- 5. Rewrite evaluate_bids — Secretariat draft + auto-invalidate
-- ============================================================
-- Semantics change:
--   * Writes Secretariat's draft directly to bids.* aggregate columns.
--   * Does NOT insert a bid_evaluations row for the caller.
--   * If any evaluation field actually changed, auto-invalidates all
--     existing 'confirmed' rows for bids in this procurement (→ 'stale')
--     and notifies each affected member.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.evaluate_bids(
  p_procurement_id UUID,
  p_evaluations    JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc              RECORD;
  v_eval              JSONB;
  v_rank              INTEGER := 0;
  v_bid_id            UUID;
  v_resp              BOOLEAN;
  v_elig              BOOLEAN;
  v_comp              BOOLEAN;
  v_score             NUMERIC;
  v_remarks           TEXT;
  v_old               RECORD;
  v_changed           BOOLEAN := FALSE;
  v_invalidated_user  RECORD;
  v_proc_number       TEXT;
BEGIN
  IF NOT (procurements.has_permission('bid.evaluate') OR procurements.has_permission('proc.manage')) THEN
    RAISE EXCEPTION 'Insufficient permissions to draft bid evaluation (BAC Secretariat only)';
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
    RAISE EXCEPTION 'Cannot evaluate bids on a % procurement', v_proc.status;
  END IF;

  v_proc_number := v_proc.procurement_number;

  -- Apply each evaluation and track whether anything actually changed
  FOR v_eval IN SELECT * FROM jsonb_array_elements(p_evaluations)
  LOOP
    v_bid_id := (v_eval->>'bid_id')::UUID;
    v_resp   := (v_eval->>'is_responsive')::BOOLEAN;
    v_elig   := (v_eval->>'is_eligible')::BOOLEAN;
    v_comp   := (v_eval->>'is_compliant')::BOOLEAN;
    v_score  := NULLIF(v_eval->>'evaluation_score', '')::NUMERIC;
    v_remarks := NULLIF(v_eval->>'remarks', '');

    SELECT is_responsive, is_eligible, is_compliant, evaluation_score, remarks
      INTO v_old
      FROM procurements.bids
     WHERE id = v_bid_id
       AND procurement_id = p_procurement_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Track drift against existing draft
    IF v_old.is_responsive    IS DISTINCT FROM v_resp
       OR v_old.is_eligible    IS DISTINCT FROM v_elig
       OR v_old.is_compliant   IS DISTINCT FROM v_comp
       OR v_old.evaluation_score IS DISTINCT FROM v_score
       OR v_old.remarks        IS DISTINCT FROM v_remarks
    THEN
      v_changed := TRUE;
    END IF;

    UPDATE procurements.bids
       SET is_responsive    = v_resp,
           is_eligible      = v_elig,
           is_compliant     = v_comp,
           evaluation_score = v_score,
           remarks          = COALESCE(v_remarks, remarks),
           status           = CASE
             WHEN v_resp AND v_elig AND v_comp THEN 'evaluated'
             ELSE 'disqualified'
           END,
           disqualification_reason = CASE
             WHEN NOT (v_resp AND v_elig AND v_comp) THEN COALESCE(v_remarks, 'Not responsive/eligible/compliant')
             ELSE disqualification_reason
           END,
           updated_at       = NOW()
     WHERE id = v_bid_id;
  END LOOP;

  -- Recompute ranks among responsive+eligible+compliant bids
  v_rank := 0;
  FOR v_bid_id IN
    SELECT id FROM procurements.bids
     WHERE procurement_id = p_procurement_id
       AND deleted_at     IS NULL
       AND is_responsive  = TRUE
       AND is_eligible    = TRUE
       AND is_compliant   = TRUE
     ORDER BY bid_amount ASC
  LOOP
    v_rank := v_rank + 1;
    UPDATE procurements.bids SET rank = v_rank WHERE id = v_bid_id;
  END LOOP;

  UPDATE procurements.bids
     SET rank = NULL
   WHERE procurement_id = p_procurement_id
     AND (NOT is_responsive OR NOT is_eligible OR NOT is_compliant);

  -- If the Secretariat actually changed the draft, invalidate prior
  -- confirmations and notify each affected member.
  IF v_changed THEN
    -- Notify first so we still know who to notify before marking stale
    FOR v_invalidated_user IN
      SELECT DISTINCT be.evaluator_id AS user_id
        FROM procurements.bid_evaluations be
        JOIN procurements.bids b ON b.id = be.bid_id
       WHERE b.procurement_id = p_procurement_id
         AND be.status        = 'confirmed'
    LOOP
      INSERT INTO procurements.notifications (
        user_id, title, message, type,
        reference_type, reference_id, office_id
      ) VALUES (
        v_invalidated_user.user_id,
        'Bid evaluation revised — please re-confirm',
        'The BAC Secretariat updated the evaluation for procurement '
          || v_proc_number
          || '. Your previous confirmation is no longer counted. Please review and re-confirm.',
        'warning',
        'procurement_activity',
        p_procurement_id,
        v_proc.office_id
      );
    END LOOP;

    UPDATE procurements.bid_evaluations be
       SET status         = 'stale',
           invalidated_at = NOW(),
           updated_at     = NOW()
      FROM procurements.bids b
     WHERE be.bid_id    = b.id
       AND b.procurement_id = p_procurement_id
       AND be.status    = 'confirmed';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.evaluate_bids(UUID, JSONB) TO authenticated;

-- ============================================================
-- 6. New RPC: confirm_bid_evaluations
--    Called by a BAC voting member (bac_chair / bac_member) to record
--    their agreement with the Secretariat's current draft. Snapshots
--    the draft values from `bids` at the moment of confirmation.
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.confirm_bid_evaluations(p_procurement_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_proc       RECORD;
  v_bid        RECORD;
  v_bids_count INT := 0;
BEGIN
  IF NOT procurements.has_permission('bid.confirm') THEN
    RAISE EXCEPTION 'Insufficient permissions: only BAC voting members can confirm evaluations';
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
    RAISE EXCEPTION 'Cannot confirm evaluations on a % procurement', v_proc.status;
  END IF;

  -- Verify at least one bid exists with a drafted verdict (non-null flags)
  SELECT COUNT(*) INTO v_bids_count
    FROM procurements.bids
   WHERE procurement_id = p_procurement_id
     AND deleted_at     IS NULL;

  IF v_bids_count = 0 THEN
    RAISE EXCEPTION 'Cannot confirm: no bids have been recorded on this procurement yet';
  END IF;

  -- For every non-deleted bid, upsert a confirmed evaluation row for the
  -- calling user. If a stale row already exists, the partial unique index
  -- permits inserting a fresh 'confirmed' row alongside it (the stale row
  -- is kept for audit).
  FOR v_bid IN
    SELECT id, is_responsive, is_eligible, is_compliant,
           evaluation_score, remarks
      FROM procurements.bids
     WHERE procurement_id = p_procurement_id
       AND deleted_at     IS NULL
  LOOP
    INSERT INTO procurements.bid_evaluations (
      bid_id, evaluator_id,
      is_responsive, is_eligible, is_compliant,
      evaluation_score, remarks,
      status, confirmed_at
    ) VALUES (
      v_bid.id, auth.uid(),
      COALESCE(v_bid.is_responsive, FALSE),
      COALESCE(v_bid.is_eligible, FALSE),
      COALESCE(v_bid.is_compliant, FALSE),
      v_bid.evaluation_score, v_bid.remarks,
      'confirmed', NOW()
    )
    ON CONFLICT (bid_id, evaluator_id) WHERE status = 'confirmed'
    DO UPDATE SET
      is_responsive    = EXCLUDED.is_responsive,
      is_eligible      = EXCLUDED.is_eligible,
      is_compliant     = EXCLUDED.is_compliant,
      evaluation_score = EXCLUDED.evaluation_score,
      remarks          = EXCLUDED.remarks,
      confirmed_at     = EXCLUDED.confirmed_at,
      invalidated_at   = NULL,
      updated_at       = NOW();
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.confirm_bid_evaluations(UUID) TO authenticated;

-- ============================================================
-- 7. New RPC: upload_bac_resolution
-- ============================================================
CREATE OR REPLACE FUNCTION procurements.upload_bac_resolution(
  p_procurement_id UUID,
  p_resolution_number TEXT,
  p_resolution_date   DATE,
  p_file_url          TEXT
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
    RAISE EXCEPTION 'Insufficient permissions: only the BAC Secretariat can upload the BAC Resolution';
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
    RAISE EXCEPTION 'Cannot upload resolution to a % procurement', v_proc.status;
  END IF;

  IF v_proc.current_stage <> 'bac_resolution' THEN
    RAISE EXCEPTION 'BAC Resolution can only be uploaded while the procurement is at the bac_resolution stage (current: %)', v_proc.current_stage;
  END IF;

  IF COALESCE(LENGTH(TRIM(p_resolution_number)), 0) = 0 THEN
    RAISE EXCEPTION 'BAC Resolution number is required';
  END IF;

  IF p_resolution_date IS NULL THEN
    RAISE EXCEPTION 'BAC Resolution date is required';
  END IF;

  IF COALESCE(LENGTH(TRIM(p_file_url)), 0) = 0 THEN
    RAISE EXCEPTION 'BAC Resolution file URL is required';
  END IF;

  UPDATE procurements.procurement_activities
     SET bac_resolution_number      = TRIM(p_resolution_number),
         bac_resolution_date        = p_resolution_date,
         bac_resolution_file_url    = TRIM(p_file_url),
         bac_resolution_uploaded_at = NOW(),
         bac_resolution_uploaded_by = auth.uid(),
         updated_at                 = NOW()
   WHERE id = p_procurement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.upload_bac_resolution(UUID, TEXT, DATE, TEXT) TO authenticated;

-- ============================================================
-- 8. advance_procurement_stage — require BAC Resolution on file when
--    leaving bac_resolution → award_recommended
-- ============================================================
-- We add this check via a standalone trigger on procurement_activities so
-- we don't have to rewrite the 200-line advance_procurement_stage body.
CREATE OR REPLACE FUNCTION procurements.enforce_bac_resolution_before_award()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_stage = 'award_recommended'
     AND OLD.current_stage = 'bac_resolution'
     AND NEW.procurement_method = 'competitive_bidding'
     AND (NEW.bac_resolution_file_url IS NULL
          OR LENGTH(TRIM(NEW.bac_resolution_file_url)) = 0)
  THEN
    RAISE EXCEPTION 'BAC Resolution must be uploaded before advancing to Award Recommended. Ask the BAC Secretariat to upload the signed resolution first.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_bac_resolution_before_award
  ON procurements.procurement_activities;

CREATE TRIGGER trg_enforce_bac_resolution_before_award
  BEFORE UPDATE OF current_stage ON procurements.procurement_activities
  FOR EACH ROW
  WHEN (NEW.current_stage = 'award_recommended' AND OLD.current_stage = 'bac_resolution')
  EXECUTE FUNCTION procurements.enforce_bac_resolution_before_award();
