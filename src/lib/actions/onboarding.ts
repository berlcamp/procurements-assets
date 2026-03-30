"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { DivisionJoinRequestWithDivision } from "@/types/database"

export interface OnboardingInput {
  first_name: string
  last_name: string
  middle_name?: string
  suffix?: string
  position?: string
  office_id?: string
  division_id?: string
  // If creating a new division
  new_division?: {
    name: string
    code: string
    region: string
  }
}

export async function getOfficesForDivision(
  divisionId: string
): Promise<{ id: string; name: string; code: string; office_type: string }[]> {
  const adminClient = createAdminClient()
  const { data } = await adminClient
    .schema("procurements")
    .from("offices")
    .select("id, name, code, office_type")
    .eq("division_id", divisionId)
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("name")

  return (data ?? []) as { id: string; name: string; code: string; office_type: string }[]
}

export interface OnboardingResult {
  error: string | null
  requestSubmitted?: boolean
}

export async function getAvailableDivisions(): Promise<
  { id: string; name: string; code: string; region: string }[]
> {
  const adminClient = createAdminClient()
  const { data } = await adminClient
    .schema("platform")
    .from("divisions")
    .select("id, name, code, region")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("name")

  return (data ?? []) as { id: string; name: string; code: string; region: string }[]
}

export async function completeOnboarding(
  input: OnboardingInput
): Promise<OnboardingResult> {
  const supabase = await createClient()

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: "Not authenticated." }

  // Check if profile already exists (prevent double-submit)
  const { data: existing } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle()

  if (existing) return { error: null } // Already onboarded

  // Use admin client to bypass RLS for profile creation
  const adminClient = createAdminClient()

  // Check for existing pending request (prevent duplicate submit)
  const { data: existingRequest } = await adminClient
    .schema("procurements")
    .from("division_join_requests")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle()

  if (existingRequest) return { error: null, requestSubmitted: true }

  let divisionId = input.division_id

  // PATH 1: Create new division — instant onboarding (first user becomes admin)
  if (input.new_division && !divisionId) {
    const { data: division, error: divError } = await adminClient
      .schema("platform")
      .from("divisions")
      .insert({
        name: input.new_division.name,
        code: input.new_division.code.toUpperCase(),
        region: input.new_division.region,
        subscription_plan: "basic",
        subscription_status: "active",
        max_users: 50,
        max_schools: 30,
        onboarded_by: user.id,
        onboarded_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    if (divError) return { error: divError.message }
    divisionId = division.id

    // Create user profile immediately for new division creator
    const { error: profileError } = await adminClient
      .schema("procurements")
      .from("user_profiles")
      .insert({
        id: user.id,
        division_id: divisionId,
        first_name: input.first_name,
        last_name: input.last_name,
        middle_name: input.middle_name || null,
        suffix: input.suffix || null,
        position: input.position || null,
        is_active: true,
      })

    if (profileError) return { error: profileError.message }

    // Assign division_admin role to the first user
    const { data: adminRole } = await adminClient
      .schema("procurements")
      .from("roles")
      .select("id")
      .eq("name", "division_admin")
      .single()

    if (adminRole) {
      await adminClient
        .schema("procurements")
        .from("user_roles")
        .insert({
          user_id: user.id,
          role_id: adminRole.id,
          division_id: divisionId,
          is_active: true,
        })
    }

    return { error: null }
  }

  // PATH 2: Join existing division — create a join request (requires admin approval)
  if (divisionId) {
    const { error: reqError } = await adminClient
      .schema("procurements")
      .from("division_join_requests")
      .insert({
        user_id: user.id,
        division_id: divisionId,
        first_name: input.first_name,
        last_name: input.last_name,
        middle_name: input.middle_name || null,
        suffix: input.suffix || null,
        position: input.position || null,
        office_id: input.office_id || null,
        status: "pending",
      })

    if (reqError) return { error: reqError.message }

    // Notify division admins
    await notifyDivisionAdmins(adminClient, divisionId, input.first_name, input.last_name)

    return { error: null, requestSubmitted: true }
  }

  return { error: "Please select or create a division." }
}

export async function getMyJoinRequest(): Promise<DivisionJoinRequestWithDivision | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Use admin client since user has no profile and RLS blocks regular queries
  const adminClient = createAdminClient()
  const { data } = await adminClient
    .schema("procurements")
    .from("division_join_requests")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  // Fetch division details separately
  const { data: division } = await adminClient
    .schema("platform")
    .from("divisions")
    .select("id, name, code, region")
    .eq("id", data.division_id)
    .single()

  return {
    ...data,
    division: division ?? undefined,
  } as DivisionJoinRequestWithDivision
}

export async function cancelJoinRequest(): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated." }

  const adminClient = createAdminClient()
  const { error } = await adminClient
    .schema("procurements")
    .from("division_join_requests")
    .update({
      status: "rejected",
      review_notes: "Cancelled by user",
      reviewed_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("status", "pending")

  if (error) return { error: error.message }
  return { error: null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyDivisionAdmins(
  adminClient: any,
  divisionId: string,
  requesterFirstName: string,
  requesterLastName: string
): Promise<void> {
  // Find all users with division_admin role in this division
  const { data: adminRole } = await adminClient
    .schema("procurements")
    .from("roles")
    .select("id")
    .eq("name", "division_admin")
    .single()

  if (!adminRole) return

  const { data: adminRoles } = await adminClient
    .schema("procurements")
    .from("user_roles")
    .select("user_id")
    .eq("division_id", divisionId)
    .eq("role_id", adminRole.id)
    .eq("is_active", true)
    .is("revoked_at", null)

  const adminUserIds = (adminRoles ?? []).map((r: { user_id: string }) => r.user_id)
  if (adminUserIds.length === 0) return

  const notifications = adminUserIds.map((userId: string) => ({
    user_id: userId,
    title: "New Division Join Request",
    message: `${requesterFirstName} ${requesterLastName} has requested to join your division. Review the request in Admin > Users.`,
    type: "approval",
    reference_type: "join_request",
  }))

  await adminClient
    .schema("procurements")
    .from("notifications")
    .insert(notifications)
}
