-- Add remark to a PPMP via approval_logs (action = 'noted')
-- Authorized reviewers: section_chief, school_head, budget_officer, hope, division_admin

CREATE OR REPLACE FUNCTION procurements.add_ppmp_remark(
  p_ppmp_id UUID,
  p_remarks TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = procurements, platform, auth, public
AS $$
DECLARE
  v_ppmp      RECORD;
  v_log_id    UUID;
  v_step_name TEXT;
BEGIN
  IF COALESCE(TRIM(p_remarks), '') = '' THEN
    RAISE EXCEPTION 'Remarks cannot be empty';
  END IF;

  SELECT * INTO v_ppmp
    FROM procurements.ppmps
   WHERE id          = p_ppmp_id
     AND division_id = procurements.get_user_division_id()
     AND deleted_at  IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PPMP % not found or access denied', p_ppmp_id;
  END IF;

  -- Must have at least one reviewer permission
  IF NOT (
    procurements.has_permission('ppmp.chief_review')
    OR procurements.has_permission('ppmp.certify_budget')
    OR procurements.has_permission('ppmp.approve')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to add remarks on PPMP %', p_ppmp_id;
  END IF;

  -- Determine the step label based on the user's highest permission
  IF procurements.has_permission('ppmp.approve') THEN
    v_step_name := 'hope_remark';
  ELSIF procurements.has_permission('ppmp.certify_budget') THEN
    v_step_name := 'budget_officer_remark';
  ELSE
    v_step_name := 'chief_remark';
  END IF;

  INSERT INTO procurements.approval_logs (
    reference_type, reference_id, step_name, step_order,
    action, acted_by, remarks, office_id
  ) VALUES (
    'ppmp', p_ppmp_id, v_step_name, 0,
    'noted', auth.uid(), TRIM(p_remarks), v_ppmp.office_id
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;
