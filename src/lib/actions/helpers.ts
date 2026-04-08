"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// ============================================================
// Shared helpers for server actions
// ============================================================

export type UserRoleRow = { role: { name: string } | null; office_id: string | null }

export async function getUserRoleContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: profile }, { data: rolesData }] = await Promise.all([
    supabase.schema("procurements").from("user_profiles")
      .select("office_id, division_id")
      .eq("id", user.id)
      .single(),
    supabase.schema("procurements").from("user_roles")
      .select("role:roles(name), office_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .is("revoked_at", null),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roles = (rolesData ?? []) as any[] as UserRoleRow[]
  const roleNames = roles.map(r => r.role?.name).filter((n): n is string => !!n)

  return { user, profile, roleNames }
}

// ============================================================
// Notification helpers
// ============================================================

export type NotificationInsert = {
  title: string
  message: string
  type: "info" | "success" | "warning" | "error" | "approval"
  reference_type: string
  reference_id: string
}

export async function notifyRoleInOffice(roleNames: string[], officeId: string, notification: NotificationInsert) {
  const admin = createAdminClient()
  const { data: userRoles } = await admin
    .schema("procurements")
    .from("user_roles")
    .select("user_id, role:roles!inner(name)")
    .in("role.name" as string, roleNames)
    .eq("office_id", officeId)
    .eq("is_active", true)
    .is("revoked_at", null)
  if (!userRoles?.length) return
  const inserts = userRoles.map((r: { user_id: string }) => ({ user_id: r.user_id, ...notification }))
  await admin.schema("procurements").from("notifications").insert(inserts)
}

export async function notifyRoleInDivision(roleNames: string[], divisionId: string, notification: NotificationInsert) {
  const admin = createAdminClient()
  const { data: userRoles } = await admin
    .schema("procurements")
    .from("user_roles")
    .select("user_id, role:roles!inner(name)")
    .in("role.name" as string, roleNames)
    .eq("division_id", divisionId)
    .eq("is_active", true)
    .is("revoked_at", null)
  if (!userRoles?.length) return
  const inserts = userRoles.map((r: { user_id: string }) => ({ user_id: r.user_id, ...notification }))
  await admin.schema("procurements").from("notifications").insert(inserts)
}

export async function notifyUser(userId: string, notification: NotificationInsert) {
  const admin = createAdminClient()
  await admin.schema("procurements").from("notifications").insert({ user_id: userId, ...notification })
}
