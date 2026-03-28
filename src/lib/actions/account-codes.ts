"use server"

import { createClient } from "@/lib/supabase/server"
import type { AccountCode, ExpenseClass } from "@/types/database"

export interface CreateAccountCodeInput {
  code: string
  name: string
  expense_class: ExpenseClass
  parent_code_id?: string | null
  level?: number
}

export async function getAccountCodes(): Promise<AccountCode[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("account_codes")
    .select("*")
    .order("code")

  if (error) {
    console.error("getAccountCodes error:", error)
    return []
  }

  return (data ?? []) as AccountCode[]
}

export async function getAccountCodesByClass(
  expenseClass: ExpenseClass
): Promise<AccountCode[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("account_codes")
    .select("*")
    .eq("expense_class", expenseClass)
    .order("code")

  if (error) {
    console.error("getAccountCodesByClass error:", error)
    return []
  }

  return (data ?? []) as AccountCode[]
}

export async function createAccountCode(
  input: CreateAccountCodeInput
): Promise<{ data: AccountCode | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("account_codes")
    .insert({
      code: input.code,
      name: input.name,
      expense_class: input.expense_class,
      parent_code_id: input.parent_code_id ?? null,
      level: input.level ?? 1,
    })
    .select()
    .single()

  if (error) {
    console.error("createAccountCode error:", error)
    return { data: null, error: error.message }
  }

  return { data: data as AccountCode, error: null }
}

export async function updateAccountCode(
  id: string,
  input: Partial<CreateAccountCodeInput>
): Promise<{ data: AccountCode | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("account_codes")
    .update(input)
    .eq("id", id)
    .select()
    .single()

  if (error) {
    console.error("updateAccountCode error:", error)
    return { data: null, error: error.message }
  }

  return { data: data as AccountCode, error: null }
}

export async function toggleAccountCodeStatus(
  id: string,
  isActive: boolean
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("account_codes")
    .update({ is_active: isActive })
    .eq("id", id)

  if (error) {
    console.error("toggleAccountCodeStatus error:", error)
    return { error: error.message }
  }

  return { error: null }
}
