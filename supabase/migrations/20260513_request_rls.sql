-- Phase 14: Request System — RLS Policies
-- Creators see own, supervisors see office, processors see all.
-- Request items inherit access from parent request.

-- ============================================================
-- 1. requests — multi-layer SELECT
-- ============================================================

-- Creators see their own requests
CREATE POLICY "creator_read_requests" ON procurements.requests
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND requested_by = auth.uid()
  );

-- Supervisors see requests in their accessible offices
CREATE POLICY "supervisor_read_requests" ON procurements.requests
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND procurements.has_permission('request.approve')
    AND office_id = ANY(procurements.get_user_accessible_office_ids())
  );

-- Supply officers / processors see all non-draft requests in division
CREATE POLICY "processor_read_requests" ON procurements.requests
  FOR SELECT TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND procurements.has_permission('request.process')
  );

-- ============================================================
-- 2. requests — INSERT / UPDATE
-- ============================================================

-- Users with request.create can create requests
CREATE POLICY "create_requests" ON procurements.requests
  FOR INSERT TO authenticated
  WITH CHECK (
    division_id = procurements.get_user_division_id()
    AND procurements.has_permission('request.create')
    AND procurements.is_division_active()
  );

-- Users with any request permission can update (status transitions
-- are validated inside SECURITY DEFINER RPCs)
CREATE POLICY "update_requests" ON procurements.requests
  FOR UPDATE TO authenticated
  USING (
    division_id = procurements.get_user_division_id()
    AND deleted_at IS NULL
    AND (
      procurements.has_permission('request.create')
      OR procurements.has_permission('request.approve')
      OR procurements.has_permission('request.process')
      OR platform.is_super_admin()
    )
  )
  WITH CHECK (
    division_id = procurements.get_user_division_id()
  );

-- ============================================================
-- 3. request_items — access inherited from parent request
-- ============================================================

-- Users who can see the parent request can see its items
CREATE POLICY "read_request_items" ON procurements.request_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM procurements.requests r
       WHERE r.id          = request_items.request_id
         AND r.division_id = procurements.get_user_division_id()
         AND r.deleted_at  IS NULL
         AND (
           r.requested_by = auth.uid()
           OR (
             procurements.has_permission('request.approve')
             AND r.office_id = ANY(procurements.get_user_accessible_office_ids())
           )
           OR procurements.has_permission('request.process')
         )
    )
  );

-- Users can insert items into draft requests they own, or processors
-- can insert items during fulfillment
CREATE POLICY "create_request_items" ON procurements.request_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM procurements.requests r
       WHERE r.id          = request_items.request_id
         AND r.division_id = procurements.get_user_division_id()
         AND r.deleted_at  IS NULL
         AND (
           (r.requested_by = auth.uid() AND r.status = 'draft')
           OR procurements.has_permission('request.process')
         )
    )
  );

-- Users can update items in draft (own) or processing (supply officer)
CREATE POLICY "update_request_items" ON procurements.request_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM procurements.requests r
       WHERE r.id          = request_items.request_id
         AND r.division_id = procurements.get_user_division_id()
         AND r.deleted_at  IS NULL
         AND (
           (r.requested_by = auth.uid() AND r.status = 'draft')
           OR (
             procurements.has_permission('request.process')
             AND r.status IN ('supervisor_approved', 'processing', 'partially_fulfilled')
           )
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM procurements.requests r
       WHERE r.id          = request_items.request_id
         AND r.division_id = procurements.get_user_division_id()
    )
  );

-- Users can delete items only from their own draft requests
CREATE POLICY "delete_request_items" ON procurements.request_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM procurements.requests r
       WHERE r.id          = request_items.request_id
         AND r.division_id = procurements.get_user_division_id()
         AND r.deleted_at  IS NULL
         AND r.requested_by = auth.uid()
         AND r.status = 'draft'
    )
  );
