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
import type {
  BudgetAllocationInput,
  BudgetAdjustmentInput,
} from "@/lib/schemas/budget"

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
      fiscal_year:fiscal_years(id, year, status)
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

  const { error } = await supabase.schema("procurements").from("budget_adjustments").insert({
    division_id: profile.division_id,
    budget_allocation_id: input.budget_allocation_id,
    office_id: alloc?.office_id ?? profile.office_id,
    adjustment_type: input.adjustment_type,
    amount: parseFloat(input.amount),
    justification: input.justification,
    reference_number: input.reference_number ?? null,
    created_by: user.id,
  })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/budget/adjustments")
  return { error: null }
}

export async function approveBudgetAdjustment(
  adjustmentId: string,
  remarks?: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()

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

  const { error } = await supabase
    .schema("procurements")
    .rpc("reject_budget_adjustment", {
      p_adjustment_id: adjustmentId,
      p_remarks: remarks ?? null,
    })

  if (error) return { error: error.message }

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
