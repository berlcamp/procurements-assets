"use server"

import { createClient } from "@/lib/supabase/server"
import type { SystemSetting } from "@/types/database"
import type { SystemSettingInput } from "@/lib/schemas/admin"

export async function getSettings(): Promise<SystemSetting[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("system_settings")
    .select("*")
    .order("category")
    .order("key")

  if (error) return []
  return (data ?? []) as SystemSetting[]
}

export async function upsertSetting(
  input: SystemSettingInput,
  divisionId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()

  const { error } = await supabase
    .schema("procurements")
    .from("system_settings")
    .upsert(
      {
        division_id: divisionId,
        key: input.key,
        value: input.value,
        description: input.description ?? null,
        category: input.category,
        updated_by: user.user?.id ?? null,
      },
      { onConflict: "division_id,key" }
    )

  if (error) return { error: error.message }
  return { error: null }
}

export async function deleteSetting(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("system_settings")
    .delete()
    .eq("id", id)

  if (error) return { error: error.message }
  return { error: null }
}
