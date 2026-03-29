"use server"

import { createClient } from "@/lib/supabase/server"
import type { Division } from "@/types/database"

export interface CreateDivisionInput {
  name: string
  code: string
  region: string
  address?: string | null
  contact_number?: string | null
  email?: string | null
  subscription_plan?: string
  max_users?: number
  max_schools?: number
}

export async function getDivisions(): Promise<Division[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("platform")
    .from("divisions")
    .select("*")
    .is("deleted_at", null)
    .order("name")

  if (error) {
    console.error("getDivisions error:", error)
    return []
  }

  return (data ?? []) as Division[]
}

export async function getDivisionById(id: string): Promise<Division | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("platform")
    .from("divisions")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) {
    console.error("getDivisionById error:", error)
    return null
  }

  return data as Division
}

export async function createDivision(
  input: CreateDivisionInput
): Promise<{ data: Division | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("platform")
    .from("divisions")
    .insert({
      name: input.name,
      code: input.code.toUpperCase(),
      region: input.region,
      address: input.address ?? null,
      contact_number: input.contact_number ?? null,
      email: input.email ?? null,
      subscription_plan: input.subscription_plan ?? "basic",
      max_users: input.max_users ?? 50,
      max_schools: input.max_schools ?? 30,
      subscription_status: "active",
    })
    .select()
    .single()

  if (error) {
    console.error("createDivision error:", error)
    return { data: null, error: error.message }
  }

  return { data: data as Division, error: null }
}

export async function updateDivision(
  id: string,
  input: Partial<CreateDivisionInput>
): Promise<{ data: Division | null; error: string | null }> {
  const supabase = await createClient()
  const updatePayload: Partial<CreateDivisionInput & { code: string }> = {
    ...input,
  }
  if (input.code) {
    updatePayload.code = input.code.toUpperCase()
  }

  const { data, error } = await supabase
    .schema("platform")
    .from("divisions")
    .update(updatePayload)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single()

  if (error) {
    console.error("updateDivision error:", error)
    return { data: null, error: error.message }
  }

  return { data: data as Division, error: null }
}

export async function softDeleteDivision(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("platform")
    .from("divisions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)

  if (error) {
    console.error("softDeleteDivision error:", error)
    return { error: error.message }
  }

  return { error: null }
}

export async function suspendDivision(
  id: string,
  reason?: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase.schema("platform").rpc("suspend_division", {
    p_division_id: id,
    p_reason: reason ?? null,
  })

  if (error) {
    console.error("suspendDivision error:", error)
    return { error: error.message }
  }

  return { error: null }
}

export async function reactivateDivision(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase.schema("platform").rpc("reactivate_division", {
    p_division_id: id,
  })

  if (error) {
    console.error("reactivateDivision error:", error)
    return { error: error.message }
  }

  return { error: null }
}
