"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  BudgetAllocation,
  BudgetAllocationWithDetails,
  BudgetAdjustment,
  BudgetAdjustmentWithDetails,
  BudgetSummaryRow,
  BudgetUtilizationByOffice,
  BudgetUtilizationByFundSource,
  FiscalYear,
} from "@/types/database"
import type { ObligationRequestWithDetails } from "@/types/database"
import type {
  BudgetAllocationInput,
  BudgetAdjustmentInput,
} from "@/lib/schemas/budget"
import { notifyRoleInDivision, notifyUser } from "@/lib/actions/helpers"

// ============================================================
// Fiscal Year helpers
// ============================================================

export async function getActiveFiscalYear(): Promise<FiscalYear | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .schema("procurements")
    .from("fiscal_years")
    .select("*")
    .eq("is_active", true)
    .single()
  return (data as FiscalYear) ?? null
}

export async function getFiscalYears(): Promise<FiscalYear[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .schema("procurements")
    .from("fiscal_years")
    .select("*")
    .order("year", { ascending: false })
  return (data ?? []) as FiscalYear[]
}

// ============================================================
// Obligation Requests
// ============================================================

const OBR_SELECT = `
  *,
  purchase_request:purchase_requests(
    id, pr_number, purpose, status, total_estimated_cost,
    office:offices(id, name, code),
    fiscal_year:fiscal_years(id, year)
  ),
  procurement:procurement_activities(id, procurement_number, procurement_method, status),
  budget_allocation:budget_allocations(
    id, adjusted_amount, obligated_amount,
    fund_source:fund_sources(id, name, code),
    account_code:account_codes(id, code, name)
  ),
  office:offices(id, name, code)
` as const

export async function getObligationRequests(): Promise<ObligationRequestWithDetails[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .from("obligation_requests")
    .select(OBR_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getObligationRequests error:", error)
    return []
  }

  const obrs = (data ?? []) as ObligationRequestWithDetails[]

  // Backfill certified_by profiles
  const certifierIds = new Set<string>()
  obrs.forEach(o => { if (o.certified_by) certifierIds.add(o.certified_by) })
  if (certifierIds.size > 0) {
    const { data: profiles } = await supabase
      .schema("procurements")
      .from("user_profiles")
      .select("id, first_name, last_name")
      .in("id", Array.from(certifierIds))
    const profileMap = new Map(profiles?.map(p => [p.id, p]) ?? [])
    obrs.forEach(o => {
      if (o.certified_by) o.certified_by_profile = profileMap.get(o.certified_by) ?? null
    })
  }

  return obrs
}

export interface ObligationSummary {
  total_count: number
  certified_count: number
  obligated_count: number
  cancelled_count: number
  total_certified_amount: number
  total_obligated_amount: number
}

export async function getObligationSummary(): Promise<ObligationSummary> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .from("obligation_requests")
    .select("status, amount")
    .is("deleted_at", null)

  if (error || !data) {
    console.error("getObligationSummary error:", error)
    return {
      total_count: 0,
      certified_count: 0,
      obligated_count: 0,
      cancelled_count: 0,
      total_certified_amount: 0,
      total_obligated_amount: 0,
    }
  }

  return {
    total_count: data.length,
    certified_count: data.filter(d => d.status === "certified").length,
    obligated_count: data.filter(d => d.status === "obligated").length,
    cancelled_count: data.filter(d => d.status === "cancelled").length,
    total_certified_amount: data
      .filter(d => d.status === "certified")
      .reduce((s, d) => s + parseFloat(d.amount ?? 0), 0),
    total_obligated_amount: data
      .filter(d => d.status === "obligated")
      .reduce((s, d) => s + parseFloat(d.amount ?? 0), 0),
  }
}

// ============================================================
// Obligation totals (from certified OBRs — source of truth)
// ============================================================

export async function getCertifiedObligationsTotal(
  fiscalYearId: string
): Promise<number> {
  const supabase = await createClient()

  // obligation_requests has no fiscal_year_id; resolve through purchase_requests
  const { data: prs, error: prErr } = await supabase
    .schema("procurements")
    .from("purchase_requests")
    .select("id")
    .eq("fiscal_year_id", fiscalYearId)
    .is("deleted_at", null)

  if (prErr || !prs?.length) return 0

  const prIds = prs.map((p) => p.id)

  const { data, error } = await supabase
    .schema("procurements")
    .from("obligation_requests")
    .select("amount")
    .in("purchase_request_id", prIds)
    .in("status", ["certified", "obligated"])
    .is("deleted_at", null)

  if (error) {
    console.error("getCertifiedObligationsTotal error:", error)
    return 0
  }
  return (data ?? []).reduce((sum, row) => sum + parseFloat(row.amount ?? 0), 0)
}

// ============================================================
// Budget Allocations
// ============================================================

export async function getBudgetAllocations(
  fiscalYearId?: string
): Promise<BudgetAllocationWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("budget_allocations")
    .select(`
      *,
      office:offices(id, name, code),
      fund_source:fund_sources(id, name, code),
      account_code:account_codes(id, name, code, expense_class),
      fiscal_year:fiscal_years(id, year, status),
      sub_aro:sub_allotment_release_orders(id, sub_aro_number, aro_number, allotment_class),
      saro:special_allotment_release_orders(id, saro_number, reference_number, program, allotment_class)
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (fiscalYearId) {
    query = query.eq("fiscal_year_id", fiscalYearId)
  }

  const { data, error } = await query
  if (error) {
    console.error("getBudgetAllocations error:", error)
    return []
  }
  return (data ?? []) as BudgetAllocationWithDetails[]
}

export async function getBudgetAllocationsByOffice(
  officeId: string,
  fiscalYearId: string
): Promise<BudgetAllocationWithDetails[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("budget_allocations")
    .select(`
      *,
      office:offices(id, name, code),
      fund_source:fund_sources(id, name, code),
      account_code:account_codes(id, name, code, expense_class),
      fiscal_year:fiscal_years(id, year, status)
    `)
    .eq("office_id", officeId)
    .eq("fiscal_year_id", fiscalYearId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getBudgetAllocationsByOffice error:", error)
    return []
  }
  return (data ?? []) as BudgetAllocationWithDetails[]
}

export async function getBudgetAllocationById(
  id: string
): Promise<BudgetAllocationWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("budget_allocations")
    .select(`
      *,
      office:offices(id, name, code),
      fund_source:fund_sources(id, name, code),
      account_code:account_codes(id, name, code, expense_class),
      fiscal_year:fiscal_years(id, year, status)
    `)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) return null
  return data as BudgetAllocationWithDetails
}

export async function createBudgetAllocation(
  input: BudgetAllocationInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized" }

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .single()

  if (!profile?.division_id) return { error: "No division assigned" }

  const { error } = await supabase.schema("procurements").from("budget_allocations").insert({
    division_id: profile.division_id,
    fiscal_year_id: input.fiscal_year_id,
    office_id: input.office_id,
    fund_source_id: input.fund_source_id,
    account_code_id: input.account_code_id,
    sub_aro_id: input.sub_aro_id ?? null,
    saro_id: input.saro_id ?? null,
    original_amount: parseFloat(input.original_amount),
    adjusted_amount: parseFloat(input.original_amount),
    obligated_amount: 0,
    disbursed_amount: 0,
    description: input.description ?? null,
    created_by: user.id,
  })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/budget")
  revalidatePath("/dashboard/budget/allocations")
  return { error: null }
}

export async function softDeleteBudgetAllocation(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("budget_allocations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/budget/allocations")
  return { error: null }
}

// ============================================================
// Budget Adjustments
// ============================================================

export async function getBudgetAdjustments(
  fiscalYearId?: string,
  status?: string
): Promise<BudgetAdjustmentWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("budget_adjustments")
    .select(`
      *,
      office:offices(id, name, code),
      budget_allocation:budget_allocations(
        id, original_amount, adjusted_amount, obligated_amount, disbursed_amount,
        fiscal_year_id, status,
        office:offices(id, name, code),
        fund_source:fund_sources(id, name, code),
        account_code:account_codes(id, name, code, expense_class),
        fiscal_year:fiscal_years(id, year, status)
      )
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (status) {
    query = query.eq("status", status)
  }

  const { data, error } = await query
  if (error) {
    console.error("getBudgetAdjustments error:", error)
    return []
  }

  // Filter by fiscal year if provided (via nested allocation)
  const rows = (data ?? []) as BudgetAdjustmentWithDetails[]
  if (fiscalYearId) {
    return rows.filter(
      (r) =>
        (r.budget_allocation as BudgetAllocationWithDetails)?.fiscal_year_id === fiscalYearId
    )
  }
  return rows
}

export async function getBudgetAdjustmentById(
  id: string
): Promise<BudgetAdjustmentWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("budget_adjustments")
    .select(`
      *,
      office:offices(id, name, code),
      budget_allocation:budget_allocations(
        id, original_amount, adjusted_amount, obligated_amount, disbursed_amount,
        fiscal_year_id, status,
        office:offices(id, name, code),
        fund_source:fund_sources(id, name, code),
        account_code:account_codes(id, name, code, expense_class),
        fiscal_year:fiscal_years(id, year, status)
      )
    `)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) return null
  return data as BudgetAdjustmentWithDetails
}

export async function createBudgetAdjustment(
  input: BudgetAdjustmentInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized" }

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id, office_id")
    .eq("id", user.id)
    .single()

  if (!profile?.division_id) return { error: "No division assigned" }

  // Look up the allocation to get office_id
  const { data: alloc } = await supabase
    .schema("procurements")
    .from("budget_allocations")
    .select("office_id")
    .eq("id", input.budget_allocation_id)
    .single()

  const { data: adj, error } = await supabase.schema("procurements").from("budget_adjustments").insert({
    division_id: profile.division_id,
    budget_allocation_id: input.budget_allocation_id,
    office_id: alloc?.office_id ?? profile.office_id,
    adjustment_type: input.adjustment_type,
    amount: parseFloat(input.amount),
    justification: input.justification,
    reference_number: input.reference_number ?? null,
    created_by: user.id,
  }).select("id").single()

  if (error) return { error: error.message }

  // Notify HOPE / division admin that a budget adjustment is pending approval
  if (adj?.id) {
    notifyRoleInDivision(
      ["hope", "division_admin"],
      profile.division_id,
      {
        title: "Budget Adjustment Pending",
        message: `A ${input.adjustment_type} budget adjustment of ₱${parseFloat(input.amount).toLocaleString()} requires your approval.`,
        type: "approval",
        reference_type: "budget_adjustment",
        reference_id: adj.id,
      }
    )
  }

  revalidatePath("/dashboard/budget/adjustments")
  return { error: null }
}

export async function approveBudgetAdjustment(
  adjustmentId: string,
  remarks?: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  // Fetch adjustment before approving so we can notify the creator
  const { data: adj } = await supabase
    .schema("procurements")
    .from("budget_adjustments")
    .select("created_by, adjustment_type, amount")
    .eq("id", adjustmentId)
    .single()

  const { error } = await supabase
    .schema("procurements")
    .rpc("approve_budget_adjustment", { p_adjustment_id: adjustmentId })

  if (error) return { error: error.message }

  // Update remarks if provided
  if (remarks) {
    await supabase
      .schema("procurements")
      .from("budget_adjustments")
      .update({ remarks })
      .eq("id", adjustmentId)
  }

  // Notify the creator that their adjustment was approved
  if (adj?.created_by) {
    notifyUser(adj.created_by, {
      title: "Budget Adjustment Approved",
      message: `Your ${adj.adjustment_type} budget adjustment of ₱${parseFloat(adj.amount).toLocaleString()} has been approved.`,
      type: "success",
      reference_type: "budget_adjustment",
      reference_id: adjustmentId,
    })
  }

  revalidatePath("/dashboard/budget/adjustments")
  revalidatePath(`/dashboard/budget/adjustments/${adjustmentId}`)
  revalidatePath("/dashboard/budget")
  return { error: null }
}

export async function rejectBudgetAdjustment(
  adjustmentId: string,
  remarks?: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  // Fetch adjustment before rejecting so we can notify the creator
  const { data: adj } = await supabase
    .schema("procurements")
    .from("budget_adjustments")
    .select("created_by, adjustment_type, amount")
    .eq("id", adjustmentId)
    .single()

  const { error } = await supabase
    .schema("procurements")
    .rpc("reject_budget_adjustment", {
      p_adjustment_id: adjustmentId,
      p_remarks: remarks ?? null,
    })

  if (error) return { error: error.message }

  // Notify the creator that their adjustment was rejected
  if (adj?.created_by) {
    notifyUser(adj.created_by, {
      title: "Budget Adjustment Rejected",
      message: `Your ${adj.adjustment_type} budget adjustment of ₱${parseFloat(adj.amount).toLocaleString()} has been rejected.${remarks ? ` Remarks: ${remarks}` : ""}`,
      type: "warning",
      reference_type: "budget_adjustment",
      reference_id: adjustmentId,
    })
  }

  revalidatePath("/dashboard/budget/adjustments")
  revalidatePath(`/dashboard/budget/adjustments/${adjustmentId}`)
  revalidatePath("/dashboard/budget")
  return { error: null }
}

// ============================================================
// Budget summary / utilization RPCs
// ============================================================

export async function getBudgetSummary(
  officeId: string,
  fiscalYearId: string
): Promise<BudgetSummaryRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_budget_summary", {
      p_office_id: officeId,
      p_fiscal_year_id: fiscalYearId,
    })
  if (error) {
    console.error("getBudgetSummary error:", error)
    return []
  }
  return (data ?? []) as BudgetSummaryRow[]
}

export async function getBudgetUtilizationByOffice(
  fiscalYearId: string
): Promise<BudgetUtilizationByOffice[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_budget_utilization_by_office", { p_fiscal_year_id: fiscalYearId })
  if (error) {
    console.error("getBudgetUtilizationByOffice error:", error)
    return []
  }
  return (data ?? []) as BudgetUtilizationByOffice[]
}

export async function getBudgetUtilizationByFundSource(
  fiscalYearId: string
): Promise<BudgetUtilizationByFundSource[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_budget_utilization_by_fund_source", { p_fiscal_year_id: fiscalYearId })
  if (error) {
    console.error("getBudgetUtilizationByFundSource error:", error)
    return []
  }
  return (data ?? []) as BudgetUtilizationByFundSource[]
}

// ============================================================
// Sub-ARO CRUD
// ============================================================

import type { SubAroWithDetails } from "@/types/database"
import type { SubAroInput } from "@/lib/schemas/budget"

const SUB_ARO_SELECT = `
  *,
  fiscal_year:fiscal_years(id, year, status),
  fund_source:fund_sources(id, name, code)
` as const

const SUB_ARO_DETAIL_SELECT = `
  *,
  fiscal_year:fiscal_years(id, year, status),
  fund_source:fund_sources(id, name, code),
  allocations:budget_allocations(
    *,
    office:offices(id, name, code),
    account_code:account_codes(id, name, code, expense_class)
  )
` as const

export async function getSubAros(
  fiscalYearId?: string
): Promise<SubAroWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("sub_allotment_release_orders")
    .select(SUB_ARO_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId)

  const { data, error } = await query
  if (error) {
    console.error("getSubAros error:", error)
    return []
  }
  return (data ?? []) as SubAroWithDetails[]
}

export async function getSubAroById(
  id: string
): Promise<SubAroWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("sub_allotment_release_orders")
    .select(SUB_ARO_DETAIL_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) {
    console.error("getSubAroById error:", error)
    return null
  }
  return data as SubAroWithDetails
}

export async function getActiveSubAros(
  fiscalYearId?: string
): Promise<SubAroWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("sub_allotment_release_orders")
    .select(SUB_ARO_SELECT)
    .in("status", ["active", "draft"])
    .is("deleted_at", null)
    .order("sub_aro_number")

  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId)

  const { data, error } = await query
  if (error) {
    console.error("getActiveSubAros error:", error)
    return []
  }
  return (data ?? []) as SubAroWithDetails[]
}

export async function createSubAro(
  input: SubAroInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized" }

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .single()

  if (!profile?.division_id) return { error: "No division assigned" }

  const { data, error } = await supabase
    .schema("procurements")
    .from("sub_allotment_release_orders")
    .insert({
      division_id: profile.division_id,
      fiscal_year_id: input.fiscal_year_id,
      sub_aro_number: input.sub_aro_number,
      aro_number: input.aro_number ?? null,
      allotment_class: input.allotment_class,
      fund_source_id: input.fund_source_id,
      releasing_office: input.releasing_office ?? null,
      release_date: input.release_date || null,
      validity_date: input.validity_date || null,
      purpose: input.purpose ?? null,
      total_amount: parseFloat(input.total_amount),
      status: "active",
      remarks: input.remarks ?? null,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) {
    console.error("createSubAro error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/budget")
  revalidatePath("/dashboard/budget/sub-aros")
  return { error: null, id: data.id }
}

export async function updateSubAro(
  id: string,
  input: Partial<SubAroInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const updateData: Record<string, unknown> = {}
  if (input.sub_aro_number !== undefined) updateData.sub_aro_number = input.sub_aro_number
  if (input.aro_number !== undefined) updateData.aro_number = input.aro_number || null
  if (input.allotment_class !== undefined) updateData.allotment_class = input.allotment_class
  if (input.fund_source_id !== undefined) updateData.fund_source_id = input.fund_source_id
  if (input.releasing_office !== undefined) updateData.releasing_office = input.releasing_office || null
  if (input.release_date !== undefined) updateData.release_date = input.release_date || null
  if (input.validity_date !== undefined) updateData.validity_date = input.validity_date || null
  if (input.purpose !== undefined) updateData.purpose = input.purpose || null
  if (input.total_amount !== undefined) updateData.total_amount = parseFloat(input.total_amount)
  if (input.remarks !== undefined) updateData.remarks = input.remarks || null

  const { error } = await supabase
    .schema("procurements")
    .from("sub_allotment_release_orders")
    .update(updateData)
    .eq("id", id)

  if (error) {
    console.error("updateSubAro error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/budget/sub-aros")
  return { error: null }
}

// ============================================================
// SARO CRUD
// ============================================================

import type { SaroWithDetails } from "@/types/database"
import type { SaroInput } from "@/lib/schemas/budget"

const SARO_SELECT = `
  *,
  fiscal_year:fiscal_years(id, year, status),
  fund_source:fund_sources(id, name, code)
` as const

const SARO_DETAIL_SELECT = `
  *,
  fiscal_year:fiscal_years(id, year, status),
  fund_source:fund_sources(id, name, code),
  allocations:budget_allocations(
    *,
    office:offices(id, name, code),
    account_code:account_codes(id, name, code, expense_class)
  )
` as const

export async function getSaros(
  fiscalYearId?: string
): Promise<SaroWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("special_allotment_release_orders")
    .select(SARO_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId)

  const { data, error } = await query
  if (error) {
    console.error("getSaros error:", error)
    return []
  }
  return (data ?? []) as SaroWithDetails[]
}

export async function getSaroById(
  id: string
): Promise<SaroWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("special_allotment_release_orders")
    .select(SARO_DETAIL_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) {
    console.error("getSaroById error:", error)
    return null
  }
  return data as SaroWithDetails
}

export async function getActiveSaros(
  fiscalYearId?: string
): Promise<SaroWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("special_allotment_release_orders")
    .select(SARO_SELECT)
    .in("status", ["active", "draft"])
    .is("deleted_at", null)
    .order("saro_number")

  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId)

  const { data, error } = await query
  if (error) {
    console.error("getActiveSaros error:", error)
    return []
  }
  return (data ?? []) as SaroWithDetails[]
}

export async function createSaro(
  input: SaroInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized" }

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .single()

  if (!profile?.division_id) return { error: "No division assigned" }

  const { data, error } = await supabase
    .schema("procurements")
    .from("special_allotment_release_orders")
    .insert({
      division_id: profile.division_id,
      fiscal_year_id: input.fiscal_year_id,
      saro_number: input.saro_number,
      reference_number: input.reference_number ?? null,
      program: input.program ?? null,
      allotment_class: input.allotment_class,
      fund_source_id: input.fund_source_id,
      releasing_office: input.releasing_office ?? null,
      release_date: input.release_date || null,
      validity_date: input.validity_date || null,
      purpose: input.purpose ?? null,
      total_amount: parseFloat(input.total_amount),
      status: "active",
      remarks: input.remarks ?? null,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) {
    console.error("createSaro error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/budget")
  revalidatePath("/dashboard/budget/saros")
  return { error: null, id: data.id }
}

export async function updateSaro(
  id: string,
  input: Partial<SaroInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const updateData: Record<string, unknown> = {}
  if (input.saro_number !== undefined) updateData.saro_number = input.saro_number
  if (input.reference_number !== undefined) updateData.reference_number = input.reference_number || null
  if (input.program !== undefined) updateData.program = input.program || null
  if (input.allotment_class !== undefined) updateData.allotment_class = input.allotment_class
  if (input.fund_source_id !== undefined) updateData.fund_source_id = input.fund_source_id
  if (input.releasing_office !== undefined) updateData.releasing_office = input.releasing_office || null
  if (input.release_date !== undefined) updateData.release_date = input.release_date || null
  if (input.validity_date !== undefined) updateData.validity_date = input.validity_date || null
  if (input.purpose !== undefined) updateData.purpose = input.purpose || null
  if (input.total_amount !== undefined) updateData.total_amount = parseFloat(input.total_amount)
  if (input.remarks !== undefined) updateData.remarks = input.remarks || null

  const { error } = await supabase
    .schema("procurements")
    .from("special_allotment_release_orders")
    .update(updateData)
    .eq("id", id)

  if (error) {
    console.error("updateSaro error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/budget/saros")
  return { error: null }
}
