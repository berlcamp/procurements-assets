"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  SupplierDocument,
  SupplierDocumentType,
  SupplierEligibilityCheck,
} from "@/types/database"
import { getUserRoleContext } from "@/lib/actions/helpers"

// ============================================================
// Lookup
// ============================================================

export async function getSupplierDocumentTypes(): Promise<SupplierDocumentType[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("supplier_document_types")
    .select("*")
    .order("sort_order")

  if (error) {
    console.error("getSupplierDocumentTypes error:", error)
    return []
  }
  return (data ?? []) as SupplierDocumentType[]
}

// ============================================================
// Per-supplier queries
// ============================================================

export async function getSupplierDocuments(supplierId: string): Promise<SupplierDocument[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("supplier_documents")
    .select("*")
    .eq("supplier_id", supplierId)
    .is("deleted_at", null)
    .order("document_type")
    .order("expiry_date", { ascending: false, nullsFirst: false })

  if (error) {
    console.error("getSupplierDocuments error:", error)
    return []
  }
  return (data ?? []) as SupplierDocument[]
}

export async function getSupplierEligibility(
  supplierId: string,
  method: string = "svp"
): Promise<SupplierEligibilityCheck | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("supplier_eligibility_check", {
      p_supplier_id: supplierId,
      p_method:      method,
    })

  if (error) {
    console.error("getSupplierEligibility error:", error)
    return null
  }
  return data as SupplierEligibilityCheck
}

// ============================================================
// Permission helper
// ============================================================

export async function getSupplierDocPermissions(): Promise<{
  canManage: boolean
  canVerify: boolean
}> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)
  const defaults = { canManage: false, canVerify: false }
  if (!ctx) return defaults

  const { roleNames } = ctx
  const canManage = roleNames.some(r =>
    ["division_admin", "supply_officer", "bac_secretariat"].includes(r)
  )
  const canVerify = roleNames.some(r =>
    ["division_admin", "bac_secretariat", "bac_chair"].includes(r)
  )
  return { canManage, canVerify }
}

// ============================================================
// Mutations
// ============================================================

export async function addSupplierDocument(
  supplierId: string,
  input: {
    document_type: string
    document_number?: string | null
    document_url?: string | null
    issuing_authority?: string | null
    issue_date?: string | null
    expiry_date?: string | null
    notes?: string | null
  }
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("supplier_documents")
    .insert({
      supplier_id:       supplierId,
      document_type:     input.document_type,
      document_number:   input.document_number || null,
      document_url:      input.document_url || null,
      issuing_authority: input.issuing_authority || null,
      issue_date:        input.issue_date || null,
      expiry_date:       input.expiry_date || null,
      notes:             input.notes || null,
    })
    .select("id")
    .single()

  if (error) return { id: null, error: error.message }
  revalidatePath(`/dashboard/procurement/suppliers/${supplierId}`)
  return { id: data.id as string, error: null }
}

export async function verifySupplierDocument(
  documentId: string,
  supplierId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { error } = await supabase
    .schema("procurements")
    .from("supplier_documents")
    .update({
      verified_by: user.id,
      verified_at: new Date().toISOString(),
    })
    .eq("id", documentId)

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/procurement/suppliers/${supplierId}`)
  return { error: null }
}

export async function unverifySupplierDocument(
  documentId: string,
  supplierId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("supplier_documents")
    .update({ verified_by: null, verified_at: null })
    .eq("id", documentId)

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/procurement/suppliers/${supplierId}`)
  return { error: null }
}

export async function deleteSupplierDocument(
  documentId: string,
  supplierId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("supplier_documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/procurement/suppliers/${supplierId}`)
  return { error: null }
}
