"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { DivisionJoinRequest } from "@/types/database"

export type JoinRequestWithOffice = DivisionJoinRequest & {
  office?: { id: string; name: string; code: string } | null
}

export async function getPendingJoinRequests(): Promise<JoinRequestWithOffice[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .schema("procurements")
    .from("division_join_requests")
    .select("*, office:offices!office_id(id, name, code)")
    .eq("status", "pending")
    .order("created_at")

  return (data ?? []) as unknown as JoinRequestWithOffice[]
}

export async function approveJoinRequest(
  requestId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const adminClient = createAdminClient()

  const {
    data: { user: admin },
  } = await supabase.auth.getUser()
  if (!admin) return { error: "Not authenticated." }

  // Fetch the pending request
  const { data: request, error: fetchErr } = await adminClient
    .schema("procurements")
    .from("division_join_requests")
    .select("*")
    .eq("id", requestId)
    .eq("status", "pending")
    .single()

  if (fetchErr || !request) return { error: "Request not found or already processed." }

  // Create user profile from the request data
  const { error: profileErr } = await adminClient
    .schema("procurements")
    .from("user_profiles")
    .insert({
      id: request.user_id,
      division_id: request.division_id,
      first_name: request.first_name,
      last_name: request.last_name,
      middle_name: request.middle_name,
      suffix: request.suffix,
      position: request.position,
      office_id: request.office_id ?? null,
      is_active: true,
    })

  if (profileErr) return { error: profileErr.message }

  // Mark request as approved
  await adminClient
    .schema("procurements")
    .from("division_join_requests")
    .update({
      status: "approved",
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId)

  // Notify the requesting user
  await adminClient
    .schema("procurements")
    .from("notifications")
    .insert({
      user_id: request.user_id,
      title: "Join Request Approved",
      message:
        "Your request to join the division has been approved. You can now access the system.",
      type: "success",
      reference_type: "join_request",
      reference_id: requestId,
    })

  return { error: null }
}

export async function rejectJoinRequest(
  requestId: string,
  notes?: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const adminClient = createAdminClient()

  const {
    data: { user: admin },
  } = await supabase.auth.getUser()
  if (!admin) return { error: "Not authenticated." }

  const { data: request } = await adminClient
    .schema("procurements")
    .from("division_join_requests")
    .select("*")
    .eq("id", requestId)
    .eq("status", "pending")
    .single()

  if (!request) return { error: "Request not found or already processed." }

  await adminClient
    .schema("procurements")
    .from("division_join_requests")
    .update({
      status: "rejected",
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
      review_notes: notes || null,
    })
    .eq("id", requestId)

  // Notify the user of rejection
  await adminClient
    .schema("procurements")
    .from("notifications")
    .insert({
      user_id: request.user_id,
      title: "Join Request Declined",
      message: notes
        ? `Your request was declined. Reason: ${notes}`
        : "Your request to join the division was declined. You may try another division.",
      type: "error",
      reference_type: "join_request",
      reference_id: requestId,
    })

  return { error: null }
}
