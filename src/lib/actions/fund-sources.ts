"use server"

import { createClient } from "@/lib/supabase/server"
import type { FundSource } from "@/types/database"

export interface CreateFundSourceInput {
  code: string
  name: string
  description?: string | null
}

export async function getFundSources(): Promise<FundSource[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("fund_sources")
    .select("*")
    .order("code")

  if (error) {
    console.error("getFundSources error:", error)
    return []
  }

  return (data ?? []) as FundSource[]
}

export async function createFundSource(
  input: CreateFundSourceInput
): Promise<{ data: FundSource | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("fund_sources")
    .insert({
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error("createFundSource error:", error)
    return { data: null, error: error.message }
  }

  return { data: data as FundSource, error: null }
}

export async function updateFundSource(
  id: string,
  input: Partial<CreateFundSourceInput>
): Promise<{ data: FundSource | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("fund_sources")
    .update(input)
    .eq("id", id)
    .select()
    .single()

  if (error) {
    console.error("updateFundSource error:", error)
    return { data: null, error: error.message }
  }

  return { data: data as FundSource, error: null }
}

export async function toggleFundSourceStatus(
  id: string,
  isActive: boolean
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("fund_sources")
    .update({ is_active: isActive })
    .eq("id", id)

  if (error) {
    console.error("toggleFundSourceStatus error:", error)
    return { error: error.message }
  }

  return { error: null }
}
