"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Office, OfficeWithChildren } from "@/types/database"
import type { OfficeInput } from "@/lib/schemas/admin"

export async function getOffices(): Promise<Office[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("offices")
    .select("*")
    .is("deleted_at", null)
    .order("name")

  if (error) {
    console.error("getOffices error:", error)
    return []
  }

  return (data ?? []) as Office[]
}

export async function getOfficeById(id: string): Promise<Office | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("offices")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) return null
  return data as Office
}

export async function getOfficeTree(): Promise<OfficeWithChildren[]> {
  const offices = await getOffices()

  const map = new Map<string, OfficeWithChildren>()
  offices.forEach((o) => map.set(o.id, { ...o, children: [] }))

  const roots: OfficeWithChildren[] = []
  map.forEach((office) => {
    if (office.parent_office_id && map.has(office.parent_office_id)) {
      map.get(office.parent_office_id)!.children!.push(office)
    } else {
      roots.push(office)
    }
  })

  return roots
}

export async function createOffice(
  input: OfficeInput & { division_id: string }
): Promise<{ data: Office | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("offices")
    .insert({
      ...input,
      code: input.code.toUpperCase(),
      email: input.email || null,
    })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Office, error: null }
}

export async function updateOffice(
  id: string,
  input: Partial<OfficeInput>
): Promise<{ data: Office | null; error: string | null }> {
  const supabase = await createClient()
  const payload = { ...input }
  if (input.code) payload.code = input.code.toUpperCase()
  if (input.email === "") payload.email = null

  const { data, error } = await supabase
    .schema("procurements")
    .from("offices")
    .update(payload)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as Office, error: null }
}

export async function softDeleteOffice(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("offices")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", id)
    .is("deleted_at", null)

  if (error) return { error: error.message }
  return { error: null }
}
