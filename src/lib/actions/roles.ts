"use server"

import { createClient } from "@/lib/supabase/server"
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
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_user_permissions")
  if (error) return []
  return (data as string[]) ?? []
}
