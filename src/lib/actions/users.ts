"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { UserProfile, UserRoleWithRole } from "@/types/database"
import type { UserProfileInput, AssignRoleInput } from "@/lib/schemas/admin"

export async function getUsers(): Promise<UserProfile[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("*")
    .is("deleted_at", null)
    .order("last_name")

  if (error) {
    console.error("getUsers error:", error)
    return []
  }

  return (data ?? []) as UserProfile[]
}

export async function getUserById(id: string): Promise<UserProfile | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) return null
  return data as UserProfile
}

export async function getUserRoles(userId: string): Promise<UserRoleWithRole[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("user_roles")
    .select("*, role:roles(*), office:offices(*)")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("revoked_at", null)

  if (error) return []
  return (data ?? []) as unknown as UserRoleWithRole[]
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=1`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    },
  })
  if (!res.ok) return null
  const json = await res.json()
  const users: Array<{ id: string; email: string }> = json.users ?? []
  return users.find((u) => u.email === email)?.id ?? null
}

export async function inviteUser(
  input: UserProfileInput,
  divisionId: string
): Promise<{ data: UserProfile | null; error: string | null }> {
  const adminClient = createAdminClient()
  const supabase = await createClient()

  let userId: string

  const { data: authData, error: authError } = await adminClient.auth.admin.inviteUserByEmail(
    input.email,
    { data: { division_id: divisionId } }
  )

  if (authError) {
    const alreadyExists =
      authError.message.toLowerCase().includes("already been registered") ||
      authError.message.toLowerCase().includes("already registered") ||
      (authError as { code?: string }).code === "email_exists"

    if (!alreadyExists) return { data: null, error: authError.message }

    // Auth user exists — look up their ID via the GoTrue admin API
    const existingId = await findAuthUserIdByEmail(input.email)
    if (!existingId) return { data: null, error: "User already exists but could not be located." }

    // Check if they already have a profile in this division
    const { data: existingProfile } = await supabase
      .schema("procurements")
      .from("user_profiles")
      .select("id")
      .eq("id", existingId)
      .eq("division_id", divisionId)
      .is("deleted_at", null)
      .maybeSingle()

    if (existingProfile) {
      return { data: null, error: "This user already belongs to this division." }
    }

    userId = existingId
  } else {
    userId = authData.user.id
  }

  // Create the user profile
  const { data, error } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .insert({
      id: userId,
      division_id: divisionId,
      first_name: input.first_name,
      middle_name: input.middle_name ?? null,
      last_name: input.last_name,
      suffix: input.suffix ?? null,
      employee_id: input.employee_id ?? null,
      position: input.position ?? null,
      department: input.department ?? null,
      office_id: input.office_id ?? null,
      contact_number: input.contact_number ?? null,
    })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as UserProfile, error: null }
}

export async function updateUserProfile(
  id: string,
  input: Partial<UserProfileInput>
): Promise<{ data: UserProfile | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .update({
      first_name: input.first_name,
      middle_name: input.middle_name ?? null,
      last_name: input.last_name,
      suffix: input.suffix ?? null,
      employee_id: input.employee_id ?? null,
      position: input.position ?? null,
      department: input.department ?? null,
      office_id: input.office_id ?? null,
      contact_number: input.contact_number ?? null,
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as UserProfile, error: null }
}

export async function assignRole(
  input: AssignRoleInput,
  divisionId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("user_roles")
    .insert({
      user_id: input.user_id,
      role_id: input.role_id,
      division_id: divisionId,
      office_id: input.office_id ?? null,
      is_active: true,
    })

  if (error) return { error: error.message }
  return { error: null }
}

export async function revokeRole(
  userRoleId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("user_roles")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("id", userRoleId)

  if (error) return { error: error.message }
  return { error: null }
}

export async function deactivateUser(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .update({ is_active: false })
    .eq("id", id)
    .is("deleted_at", null)

  if (error) return { error: error.message }
  return { error: null }
}
