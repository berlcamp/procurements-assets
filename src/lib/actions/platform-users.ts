"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type {
  Division,
  Office,
  Role,
  UserProfile,
  UserProfileForTable,
  UserRoleWithRole,
} from "@/types/database"
import type {
  AssignRoleInput,
  InviteUserInput,
  UserProfileInput,
} from "@/lib/schemas/admin"

/**
 * Guard: every mutation below must be invoked by a super admin. Since the
 * proxy already blocks /platform routes from non-super-admins, these server
 * actions double-check the JWT metadata to prevent a lower-privileged caller
 * from hitting these endpoints directly.
 */
async function assertSuperAdmin(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return "Not authenticated."
  if (user.user_metadata?.is_super_admin !== true) {
    return "Super admin privileges required."
  }
  return null
}

export interface PlatformUserRow extends UserProfileForTable {
  division?: Pick<Division, "id" | "name" | "code"> | null
}

/**
 * Lists every user profile across every division. Uses the admin client to
 * bypass division-scoped RLS. Returns joined office, division, roles, and
 * auth email for display.
 */
export async function getAllPlatformUsers(): Promise<PlatformUserRow[]> {
  const guard = await assertSuperAdmin()
  if (guard) return []

  const admin = createAdminClient()

  const { data: profiles, error } = await admin
    .schema("procurements")
    .from("user_profiles")
    .select("*, office:offices!office_id(id, name, code)")
    .is("deleted_at", null)
    .order("last_name")

  if (error) {
    console.error("getAllPlatformUsers profiles error:", error)
    return []
  }

  if (!profiles || profiles.length === 0) return []

  const userIds = profiles.map((p) => p.id)
  const divisionIds = Array.from(new Set(profiles.map((p) => p.division_id)))

  const [{ data: allUserRoles }, { data: divisions }] = await Promise.all([
    admin
      .schema("procurements")
      .from("user_roles")
      .select("user_id, role:roles!inner(id, name, display_name)")
      .in("user_id", userIds)
      .eq("is_active", true)
      .is("revoked_at", null),
    admin
      .schema("platform")
      .from("divisions")
      .select("id, name, code")
      .in("id", divisionIds),
  ])

  const rolesByUser = new Map<string, { id: string; name: string; display_name: string }[]>()
  for (const ur of allUserRoles ?? []) {
    const role = ur.role as unknown as { id: string; name: string; display_name: string }
    const list = rolesByUser.get(ur.user_id) ?? []
    list.push(role)
    rolesByUser.set(ur.user_id, list)
  }

  const divisionById = new Map<string, { id: string; name: string; code: string }>(
    (divisions ?? []).map((d) => [d.id, d])
  )

  // Fetch emails in parallel (limited concurrency via Promise.all — admin API
  // can handle this volume for typical division sizes)
  const emailResults = await Promise.all(
    userIds.map((id) => admin.auth.admin.getUserById(id))
  )
  const emailMap = new Map<string, string>()
  for (const res of emailResults) {
    const u = res.data?.user
    if (u?.email) emailMap.set(u.id, u.email)
  }

  return profiles.map((p) => ({
    ...p,
    office: (p.office as unknown as { id: string; name: string; code: string }) ?? null,
    division: divisionById.get(p.division_id) ?? null,
    roles: rolesByUser.get(p.id) ?? [],
    email: emailMap.get(p.id),
  })) as PlatformUserRow[]
}

export async function getPlatformUserById(id: string): Promise<UserProfile | null> {
  const guard = await assertSuperAdmin()
  if (guard) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .schema("procurements")
    .from("user_profiles")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) return null
  return data as UserProfile
}

export async function getPlatformUserEmail(id: string): Promise<string | null> {
  const guard = await assertSuperAdmin()
  if (guard) return null

  const admin = createAdminClient()
  const { data } = await admin.auth.admin.getUserById(id)
  return data?.user?.email ?? null
}

export async function getPlatformUserRoles(userId: string): Promise<UserRoleWithRole[]> {
  const guard = await assertSuperAdmin()
  if (guard) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .schema("procurements")
    .from("user_roles")
    .select("*, role:roles(*), office:offices(*)")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("revoked_at", null)

  if (error) return []
  return (data ?? []) as unknown as UserRoleWithRole[]
}

export async function getPlatformDivisionRoles(): Promise<Role[]> {
  const guard = await assertSuperAdmin()
  if (guard) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .schema("procurements")
    .from("roles")
    .select("*")
    .in("scope", ["division", "office"])
    .order("display_name")

  if (error) return []
  return (data ?? []) as Role[]
}

/** Returns all offices for a given division — used to populate the office
 *  selector on the invite form and the profile edit form. */
export async function getPlatformOfficesForDivision(divisionId: string): Promise<Office[]> {
  const guard = await assertSuperAdmin()
  if (guard) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .schema("procurements")
    .from("offices")
    .select("*")
    .eq("division_id", divisionId)
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("name")

  if (error) return []
  return (data ?? []) as Office[]
}

export async function updatePlatformUserProfile(
  id: string,
  input: Partial<UserProfileInput>
): Promise<{ data: UserProfile | null; error: string | null }> {
  const guard = await assertSuperAdmin()
  if (guard) return { data: null, error: guard }

  const admin = createAdminClient()
  const { data, error } = await admin
    .schema("procurements")
    .from("user_profiles")
    .update({
      first_name: input.first_name,
      middle_name: input.middle_name || null,
      last_name: input.last_name,
      suffix: input.suffix || null,
      employee_id: input.employee_id || null,
      position: input.position || null,
      department: input.department || null,
      office_id: input.office_id ?? null,
      contact_number: input.contact_number || null,
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single()

  if (error) return { data: null, error: error.message }

  revalidatePath("/platform/users")
  revalidatePath(`/platform/users/${id}`)
  return { data: data as UserProfile, error: null }
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

export async function invitePlatformUser(
  input: InviteUserInput,
  divisionId: string
): Promise<{ data: UserProfile | null; error: string | null }> {
  const guard = await assertSuperAdmin()
  if (guard) return { data: null, error: guard }

  const admin = createAdminClient()
  let userId: string

  const { data: authData, error: authError } =
    await admin.auth.admin.inviteUserByEmail(input.email, {
      data: { division_id: divisionId },
    })

  if (authError) {
    const alreadyExists =
      authError.message.toLowerCase().includes("already been registered") ||
      authError.message.toLowerCase().includes("already registered") ||
      (authError as { code?: string }).code === "email_exists"

    if (!alreadyExists) return { data: null, error: authError.message }

    const existingId = await findAuthUserIdByEmail(input.email)
    if (!existingId) {
      return { data: null, error: "User already exists but could not be located." }
    }

    const { data: existingProfile } = await admin
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

  const { data, error } = await admin
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
      office_id: input.office_id,
      contact_number: input.contact_number ?? null,
    })
    .select()
    .single()

  if (error) return { data: null, error: error.message }

  const roleRes = await assignPlatformRole(
    { user_id: userId, role_id: input.role_id, office_id: input.office_id },
    divisionId
  )
  if (roleRes.error) {
    await admin.schema("procurements").from("user_profiles").delete().eq("id", userId)
    return { data: null, error: roleRes.error }
  }

  revalidatePath("/platform/users")
  revalidatePath(`/platform/divisions/${divisionId}/users`)
  return { data: data as UserProfile, error: null }
}

export async function assignPlatformRole(
  input: AssignRoleInput,
  divisionId: string
): Promise<{ error: string | null }> {
  const guard = await assertSuperAdmin()
  if (guard) return { error: guard }

  const admin = createAdminClient()
  const { error } = await admin
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

  revalidatePath(`/platform/users/${input.user_id}`)
  revalidatePath(`/platform/divisions/${divisionId}/users`)
  return { error: null }
}

export async function revokePlatformRole(
  userRoleId: string
): Promise<{ error: string | null }> {
  const guard = await assertSuperAdmin()
  if (guard) return { error: guard }

  const admin = createAdminClient()

  // Refuse to revoke the division creator's admin role — same guard as the
  // division-scoped revoke action, protecting the last admin of a division.
  const { data: userRole } = await admin
    .schema("procurements")
    .from("user_roles")
    .select("user_id, division_id, role:roles!inner(name)")
    .eq("id", userRoleId)
    .single()

  if (userRole && (userRole.role as unknown as { name: string }).name === "division_admin") {
    const { data: division } = await admin
      .schema("platform")
      .from("divisions")
      .select("onboarded_by")
      .eq("id", userRole.division_id)
      .single()

    if (division?.onboarded_by === userRole.user_id) {
      return { error: "Cannot revoke the division creator's admin role." }
    }
  }

  const { error } = await admin
    .schema("procurements")
    .from("user_roles")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("id", userRoleId)

  if (error) return { error: error.message }

  if (userRole) {
    revalidatePath(`/platform/users/${userRole.user_id}`)
    revalidatePath(`/platform/divisions/${userRole.division_id}/users`)
  }
  return { error: null }
}

export async function deactivatePlatformUser(
  id: string
): Promise<{ error: string | null }> {
  const guard = await assertSuperAdmin()
  if (guard) return { error: guard }

  const admin = createAdminClient()

  const { data: profile } = await admin
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", id)
    .single()

  if (profile) {
    const { data: division } = await admin
      .schema("platform")
      .from("divisions")
      .select("onboarded_by")
      .eq("id", profile.division_id)
      .single()

    if (division?.onboarded_by === id) {
      return { error: "Cannot deactivate the division creator." }
    }
  }

  const { error } = await admin
    .schema("procurements")
    .from("user_profiles")
    .update({ is_active: false })
    .eq("id", id)
    .is("deleted_at", null)

  if (error) return { error: error.message }

  revalidatePath("/platform/users")
  revalidatePath(`/platform/users/${id}`)
  if (profile) {
    revalidatePath(`/platform/divisions/${profile.division_id}/users`)
  }
  return { error: null }
}

export async function reactivatePlatformUser(
  id: string
): Promise<{ error: string | null }> {
  const guard = await assertSuperAdmin()
  if (guard) return { error: guard }

  const admin = createAdminClient()
  const { error } = await admin
    .schema("procurements")
    .from("user_profiles")
    .update({ is_active: true })
    .eq("id", id)
    .is("deleted_at", null)

  if (error) return { error: error.message }

  revalidatePath("/platform/users")
  revalidatePath(`/platform/users/${id}`)
  return { error: null }
}
