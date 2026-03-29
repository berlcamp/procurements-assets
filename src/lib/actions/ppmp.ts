"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  Ppmp,
  PpmpWithDetails,
  PpmpVersion,
  PpmpVersionWithItems,
  PpmpItem,
  PpmpItemWithAllocation,
  PpmpVersionHistoryRow,
  FiscalYear,
  Office,
} from "@/types/database"
import type {
  PpmpHeaderInput,
  PpmpItemInput,
  PpmpAmendmentInput,
  PpmpChiefReviewInput,
  PpmpCertifyInput,
  PpmpApproveInput,
  PpmpReturnInput,
} from "@/lib/schemas/ppmp"

// ============================================================
// PPMP queries
// ============================================================

export async function getPpmps(
  fiscalYearId?: string
): Promise<PpmpWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("ppmps")
    .select(`
      *,
      office:offices(id, name, code, office_type),
      fiscal_year:fiscal_years(id, year, status)
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (fiscalYearId) {
    query = query.eq("fiscal_year_id", fiscalYearId)
  }

  const { data, error } = await query
  if (error) {
    console.error("getPpmps error:", error)
    return []
  }
  return (data ?? []) as PpmpWithDetails[]
}

export async function getPpmpById(
  id: string
): Promise<PpmpWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmps")
    .select(`
      *,
      office:offices(id, name, code, office_type),
      fiscal_year:fiscal_years(id, year, status)
    `)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) return null
  return data as PpmpWithDetails
}

export async function getCurrentPpmpVersion(
  ppmpId: string
): Promise<PpmpVersionWithItems | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_versions")
    .select(`
      *,
      ppmp_items(*)
    `)
    .eq("ppmp_id", ppmpId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single()

  if (error) return null

  // Filter out soft-deleted items and sort by item_number
  if (data?.ppmp_items) {
    (data as PpmpVersionWithItems).ppmp_items = (
      (data as PpmpVersionWithItems).ppmp_items ?? []
    )
      .filter((item: PpmpItem) => item.deleted_at === null)
      .sort((a: PpmpItem, b: PpmpItem) => a.item_number - b.item_number)
  }

  return data as PpmpVersionWithItems
}

export async function getPpmpItems(
  ppmpVersionId: string
): Promise<PpmpItemWithAllocation[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_items")
    .select(`
      *,
      budget_allocation:budget_allocations(
        id, original_amount, adjusted_amount, obligated_amount, disbursed_amount,
        fiscal_year_id, status, description,
        office:offices(id, name, code),
        fund_source:fund_sources(id, name, code),
        account_code:account_codes(id, name, code, expense_class),
        fiscal_year:fiscal_years(id, year, status)
      )
    `)
    .eq("ppmp_version_id", ppmpVersionId)
    .is("deleted_at", null)
    .order("item_number", { ascending: true })

  if (error) {
    console.error("getPpmpItems error:", error)
    return []
  }
  return (data ?? []) as PpmpItemWithAllocation[]
}

export async function getPpmpVersionById(
  versionId: string
): Promise<PpmpVersionWithItems | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_versions")
    .select(`
      *,
      ppmp_items(*)
    `)
    .eq("id", versionId)
    .single()

  if (error) return null

  // Filter out soft-deleted items and sort by item_number
  if (data?.ppmp_items) {
    (data as PpmpVersionWithItems).ppmp_items = (
      (data as PpmpVersionWithItems).ppmp_items ?? []
    )
      .filter((item: PpmpItem) => item.deleted_at === null)
      .sort((a: PpmpItem, b: PpmpItem) => a.item_number - b.item_number)
  }

  return data as PpmpVersionWithItems
}

// ============================================================
// PPMP mutations
// ============================================================

export async function createPpmp(
  input: PpmpHeaderInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { id: null, error: "Unauthorized" }

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .single()

  if (!profile?.division_id) return { id: null, error: "No division assigned" }

  const { data: ppmp, error: ppmpError } = await supabase
    .schema("procurements")
    .from("ppmps")
    .insert({
      division_id: profile.division_id,
      office_id: input.office_id,
      fiscal_year_id: input.fiscal_year_id,
      current_version: 1,
      status: "draft",
      indicative_final: "indicative",
      created_by: user.id,
    })
    .select("id")
    .single()

  if (ppmpError) return { id: null, error: ppmpError.message }
  if (!ppmp?.id) return { id: null, error: "Failed to create PPMP" }

  // Insert initial version
  const { error: versionError } = await supabase
    .schema("procurements")
    .from("ppmp_versions")
    .insert({
      ppmp_id: ppmp.id,
      version_number: 1,
      version_type: "original",
      total_estimated_cost: 0,
      status: "draft",
      indicative_final: "indicative",
      office_id: input.office_id,
      created_by: user.id,
    })

  if (versionError) return { id: null, error: versionError.message }

  revalidatePath("/dashboard/planning/ppmp")
  return { id: ppmp.id, error: null }
}

export async function addPpmpItem(
  ppmpVersionId: string,
  ppmpId: string,
  officeId: string,
  input: PpmpItemInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized" }

  // Get next item_number
  const { count } = await supabase
    .schema("procurements")
    .from("ppmp_items")
    .select("id", { count: "exact", head: true })
    .eq("ppmp_version_id", ppmpVersionId)
    .is("deleted_at", null)

  const nextItemNumber = (count ?? 0) + 1

  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_items")
    .insert({
      ppmp_version_id: ppmpVersionId,
      ppmp_id: ppmpId,
      item_number: nextItemNumber,
      category: input.category,
      description: input.description,
      unit: input.unit,
      quantity: parseFloat(input.quantity),
      estimated_unit_cost: parseFloat(input.estimated_unit_cost),
      procurement_method: input.procurement_method,
      budget_allocation_id: input.budget_allocation_id ?? null,
      schedule_q1: parseFloat(input.schedule_q1 || "0"),
      schedule_q2: parseFloat(input.schedule_q2 || "0"),
      schedule_q3: parseFloat(input.schedule_q3 || "0"),
      schedule_q4: parseFloat(input.schedule_q4 || "0"),
      is_cse: input.is_cse,
      remarks: input.remarks ?? null,
      office_id: officeId,
      created_by: user.id,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

export async function updatePpmpItem(
  itemId: string,
  input: PpmpItemInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  // Validate item belongs to a draft version before updating
  const { data: item, error: fetchError } = await supabase
    .schema("procurements")
    .from("ppmp_items")
    .select(`
      ppmp_id,
      ppmp_version_id,
      ppmp_versions!inner(status)
    `)
    .eq("id", itemId)
    .is("deleted_at", null)
    .single()

  if (fetchError || !item) return { error: "Item not found" }

  const versionStatus = (item as { ppmp_versions: { status: string } }).ppmp_versions?.status
  if (versionStatus !== "draft") {
    return { error: "Cannot edit items on a non-draft version" }
  }

  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_items")
    .update({
      category: input.category,
      description: input.description,
      unit: input.unit,
      quantity: parseFloat(input.quantity),
      estimated_unit_cost: parseFloat(input.estimated_unit_cost),
      procurement_method: input.procurement_method,
      budget_allocation_id: input.budget_allocation_id ?? null,
      schedule_q1: parseFloat(input.schedule_q1 || "0"),
      schedule_q2: parseFloat(input.schedule_q2 || "0"),
      schedule_q3: parseFloat(input.schedule_q3 || "0"),
      schedule_q4: parseFloat(input.schedule_q4 || "0"),
      is_cse: input.is_cse,
      remarks: input.remarks ?? null,
    })
    .eq("id", itemId)

  if (error) return { error: error.message }

  const ppmpId = (item as { ppmp_id: string }).ppmp_id
  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

export async function deletePpmpItem(
  itemId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", itemId)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  return { error: null }
}

// ============================================================
// PPMP workflow actions
// ============================================================

export async function submitPpmp(
  ppmpId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("submit_ppmp", { p_ppmp_id: ppmpId })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

export async function chiefReviewPpmp(
  ppmpId: string,
  input: PpmpChiefReviewInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("chief_review_ppmp", {
      p_ppmp_id: ppmpId,
      p_action: input.action,
      p_notes: input.notes ?? null,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

export async function certifyPpmpBudget(
  ppmpId: string,
  input: PpmpCertifyInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("certify_ppmp_budget", {
      p_ppmp_id: ppmpId,
      p_notes: input.notes ?? null,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

export async function approvePpmp(
  ppmpId: string,
  input: PpmpApproveInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("approve_ppmp", {
      p_ppmp_id: ppmpId,
      p_notes: input.notes ?? null,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

export async function returnPpmp(
  ppmpId: string,
  input: PpmpReturnInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("return_ppmp", {
      p_ppmp_id: ppmpId,
      p_step: input.step,
      p_notes: input.notes,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

// ============================================================
// PPMP amendment
// ============================================================

export async function createPpmpAmendment(
  ppmpId: string,
  input: PpmpAmendmentInput
): Promise<{ versionId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("create_ppmp_amendment", {
      p_ppmp_id: ppmpId,
      p_justification: input.justification,
    })

  if (error) return { versionId: null, error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { versionId: data as string, error: null }
}

// ============================================================
// PPMP version history
// ============================================================

export async function getPpmpVersionHistory(
  ppmpId: string
): Promise<PpmpVersionHistoryRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_ppmp_version_history", { p_ppmp_id: ppmpId })

  if (error) {
    console.error("getPpmpVersionHistory error:", error)
    return []
  }
  return (data ?? []) as PpmpVersionHistoryRow[]
}
