"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Role, Permission } from "@/types/database"

export async function getRoles(): Promise<Role[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("roles")
    .select("*")
    .order("scope")
    .order("display_name")

  if (error) return []
  return (data ?? []) as Role[]
}

export async function getDivisionRoles(): Promise<Role[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("roles")
    .select("*")
    .in("scope", ["division", "office"])
    .order("display_name")

  if (error) return []
  return (data ?? []) as Role[]
}

export async function getRolePermissions(
  roleId: string
): Promise<Permission[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("role_permissions")
    .select("permission:permissions(*)")
    .eq("role_id", roleId)

  if (error) return []
  return (data ?? []).map((r: { permission: unknown }) => r.permission as Permission)
}

export async function getUserPermissions(): Promise<string[]> {
  const supabase = await createClient()

  // Super admins are not bound to a single division and don't have entries in
  // user_roles, so the database RPC returns only platform-scope codes for them.
  // Surface every division permission as well so UI gates that check division
  // codes (e.g. `users.manage`, `division.audit_logs`) treat super admin as
  // fully authorized — server actions still re-check via assertSuperAdmin().
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.user_metadata?.is_super_admin === true) {
    const admin = createAdminClient()
    const { data: allPerms } = await admin
      .schema("procurements")
      .from("permissions")
      .select("code")
    return (allPerms ?? []).map((p) => p.code as string)
  }

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_user_permissions")
  if (error) return []
  return (data as string[]) ?? []
}
