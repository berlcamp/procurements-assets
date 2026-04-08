"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type {
  ProcurementActivityWithDetails,
  BidWithDetails,
  ProcurementSummary,
  PurchaseRequestWithDetails,
  Supplier,
} from "@/types/database"
import type {
  CreateProcurementInput,
  RecordBidInput,
  EvaluateBidsInput,
  AwardProcurementInput,
  ApproveAwardInput,
  FailProcurementInput,
  AdvanceStageInput,
} from "@/lib/schemas/procurement"
import {
  getUserRoleContext,
  notifyRoleInDivision,
  notifyUser,
} from "@/lib/actions/helpers"

// ============================================================
// Select strings
// ============================================================

const PROCUREMENT_SELECT = `
  *,
  purchase_request:purchase_requests(
    *,
    office:offices(id, name, code),
    fiscal_year:fiscal_years(id, year, status),
    fund_source:fund_sources(id, name, code),
    budget_allocation:budget_allocations(id, adjusted_amount, obligated_amount),
    app_item:app_items(id, item_number, general_description, estimated_budget, procurement_mode, project_type, source_of_funds),
    lot:app_lots(id, lot_name, lot_number),
    requester:user_profiles!purchase_requests_requested_by_fkey(id, first_name, last_name, position)
  ),
  supplier:suppliers(id, name, trade_name, tin),
  office:offices(id, name, code),
  fiscal_year:fiscal_years(id, year, status)
` as const

const BID_SELECT = `
  *,
  supplier:suppliers(id, name, trade_name, tin),
  items:bid_items(*)
` as const

// ============================================================
// Procurement Activity queries
// ============================================================

export async function getProcurementActivities(
  fiscalYearId?: string
): Promise<ProcurementActivityWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("procurement_activities")
    .select(PROCUREMENT_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId)

  const { data, error } = await query
  if (error) {
    console.error("getProcurementActivities error:", error)
    return []
  }
  return (data ?? []) as ProcurementActivityWithDetails[]
}

export async function getProcurementActivityById(
  id: string
): Promise<ProcurementActivityWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("procurement_activities")
    .select(PROCUREMENT_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) return null
  return data as ProcurementActivityWithDetails
}

export async function getProcurementsRequiringMyAction(): Promise<ProcurementActivityWithDetails[]> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)
  if (!ctx) return []

  const { roleNames } = ctx

  // Supply Officer / BAC Secretariat: active procurements in early stages
  const isManager = roleNames.some(r =>
    ["supply_officer", "bac_secretariat", "division_admin"].includes(r)
  )
  // BAC Chair / Members: active procurements awaiting evaluation
  const isEvaluator = roleNames.some(r =>
    ["bac_chair", "bac_member", "division_admin"].includes(r)
  )
  // HOPE: active procurements awaiting award approval
  const isApprover = roleNames.some(r =>
    ["hope", "division_chief", "division_admin"].includes(r)
  )

  if (!isManager && !isEvaluator && !isApprover) return []

  const stages: string[] = []
  if (isManager) stages.push("rfq_preparation", "rfq_sent", "canvass_preparation", "canvass_sent")
  if (isEvaluator) stages.push("quotations_received", "canvass_received", "evaluation", "comparison", "abstract_prepared")
  if (isApprover) stages.push("award_recommended")

  const { data, error } = await supabase
    .schema("procurements")
    .from("procurement_activities")
    .select(PROCUREMENT_SELECT)
    .eq("status", "active")
    .in("current_stage", stages)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) return []
  return (data ?? []) as ProcurementActivityWithDetails[]
}

export async function getProcurementUserPermissions(_procurementId: string): Promise<{
  canManage: boolean
  canRecordBid: boolean
  canEvaluate: boolean
  canRecommendAward: boolean
  canApproveAward: boolean
  canFail: boolean
  canAdvance: boolean
}> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)

  const defaults = {
    canManage: false, canRecordBid: false, canEvaluate: false,
    canRecommendAward: false, canApproveAward: false, canFail: false, canAdvance: false,
  }

  if (!ctx) return defaults

  const { roleNames } = ctx

  const isManager = roleNames.some(r =>
    ["supply_officer", "bac_secretariat", "division_admin"].includes(r)
  )
  const isEvaluator = roleNames.some(r =>
    ["bac_chair", "bac_member", "division_admin"].includes(r)
  )
  const isBacChair = roleNames.some(r =>
    ["bac_chair", "division_admin"].includes(r)
  )
  const isApprover = roleNames.some(r =>
    ["hope", "division_chief", "division_admin"].includes(r)
  )

  return {
    canManage: isManager,
    canRecordBid: isManager,
    canEvaluate: isEvaluator,
    canRecommendAward: isBacChair,
    canApproveAward: isApprover,
    canFail: isManager,
    canAdvance: isManager,
  }
}

// ============================================================
// Bid queries
// ============================================================

export async function getBidsForProcurement(
  procurementId: string
): Promise<BidWithDetails[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("bids")
    .select(BID_SELECT)
    .eq("procurement_id", procurementId)
    .is("deleted_at", null)
    .order("bid_amount", { ascending: true })

  if (error) {
    console.error("getBidsForProcurement error:", error)
    return []
  }
  return (data ?? []) as BidWithDetails[]
}

// ============================================================
// Approved PRs available for procurement
// ============================================================

export async function getApprovedPrsForProcurement(): Promise<PurchaseRequestWithDetails[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("purchase_requests")
    .select(`
      *,
      office:offices(id, name, code),
      fiscal_year:fiscal_years(id, year, status),
      app_item:app_items(id, item_number, general_description, estimated_budget, procurement_mode, project_type),
      lot:app_lots(id, lot_name, lot_number),
      requester:user_profiles!purchase_requests_requested_by_fkey(id, first_name, last_name, position)
    `)
    .eq("status", "approved")
    .is("procurement_id", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getApprovedPrsForProcurement error:", error)
    return []
  }
  return (data ?? []) as PurchaseRequestWithDetails[]
}

// ============================================================
// Active suppliers for bid recording
// ============================================================

export async function getActiveSuppliersForBid(): Promise<Pick<Supplier, "id" | "name" | "trade_name" | "tin">[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("suppliers")
    .select("id, name, trade_name, tin")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("name")

  if (error) return []
  return (data ?? []) as Pick<Supplier, "id" | "name" | "trade_name" | "tin">[]
}

// ============================================================
// Procurement stages for a specific activity
// ============================================================

export async function getProcurementStages(procurementId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("procurement_stages")
    .select("*")
    .eq("procurement_id", procurementId)
    .order("created_at", { ascending: true })

  if (error) return []
  return data ?? []
}

// ============================================================
// Procurement summary (dashboard stats)
// ============================================================

export async function getProcurementActivitySummary(
  fiscalYearId: string
): Promise<ProcurementSummary | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.schema("procurements").rpc(
    "get_procurement_summary",
    { p_fiscal_year_id: fiscalYearId }
  )
  if (error) {
    console.error("getProcurementActivitySummary error:", error)
    return null
  }
  return data as ProcurementSummary
}

// ============================================================
// Helper: get procurement meta for notifications
// ============================================================

async function getProcMeta(procId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("procurements")
    .from("procurement_activities")
    .select("id, procurement_number, division_id, office_id, purchase_request_id, purchase_requests(created_by)")
    .eq("id", procId)
    .single()
  return data as {
    id: string
    procurement_number: string
    division_id: string
    office_id: string
    purchase_request_id: string
    purchase_requests: { created_by: string } | null
  } | null
}

// ============================================================
// Mutations
// ============================================================

export async function createProcurementActivity(
  input: CreateProcurementInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()

  const { data, error } = await supabase.schema("procurements").rpc(
    "create_procurement_activity",
    { p_pr_id: input.purchase_request_id, p_method: input.procurement_method }
  )

  if (error) return { id: null, error: error.message }

  const procId = data as string

  // Notify BAC members
  const meta = await getProcMeta(procId)
  if (meta) {
    await notifyRoleInDivision(
      ["bac_chair", "bac_member", "bac_secretariat"],
      meta.division_id,
      {
        title: "New Procurement Activity",
        message: `Procurement ${meta.procurement_number} (${input.procurement_method.toUpperCase()}) has been created and is ready for processing.`,
        type: "approval",
        reference_type: "procurement",
        reference_id: procId,
      }
    )
  }

  revalidatePath("/dashboard/procurement")
  return { id: procId, error: null }
}

export async function recordBid(
  input: RecordBidInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()

  // Transform items for RPC (string -> number)
  const rpcItems = input.items.map(item => ({
    pr_item_id: item.pr_item_id,
    offered_unit_cost: parseFloat(item.offered_unit_cost),
    offered_total_cost: parseFloat(item.offered_total_cost),
    brand_model: item.brand_model || null,
    specifications: item.specifications || null,
    remarks: item.remarks || null,
  }))

  const { data, error } = await supabase.schema("procurements").rpc(
    "record_bid",
    {
      p_procurement_id: input.procurement_id,
      p_supplier_id: input.supplier_id,
      p_items: rpcItems,
    }
  )

  if (error) return { id: null, error: error.message }

  const bidId = data as string

  // Notify BAC Chair
  const meta = await getProcMeta(input.procurement_id)
  if (meta) {
    await notifyRoleInDivision(
      ["bac_chair"],
      meta.division_id,
      {
        title: "New Quotation Recorded",
        message: `A new quotation has been recorded for ${meta.procurement_number}.`,
        type: "info",
        reference_type: "procurement",
        reference_id: input.procurement_id,
      }
    )
  }

  revalidatePath("/dashboard/procurement")
  return { id: bidId, error: null }
}

export async function evaluateBids(
  input: EvaluateBidsInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  // Transform evaluations for RPC
  const rpcEvals = input.evaluations.map(e => ({
    bid_id: e.bid_id,
    is_responsive: e.is_responsive,
    is_eligible: e.is_eligible,
    is_compliant: e.is_compliant,
    evaluation_score: e.evaluation_score ? parseFloat(e.evaluation_score) : null,
    remarks: e.remarks || null,
  }))

  const { error } = await supabase.schema("procurements").rpc(
    "evaluate_bids",
    { p_procurement_id: input.procurement_id, p_evaluations: rpcEvals }
  )

  if (error) return { error: error.message }

  // Notify Supply Officer
  const meta = await getProcMeta(input.procurement_id)
  if (meta) {
    await notifyRoleInDivision(
      ["supply_officer", "bac_secretariat"],
      meta.division_id,
      {
        title: "Bids Evaluated",
        message: `Bids for ${meta.procurement_number} have been evaluated and ranked.`,
        type: "info",
        reference_type: "procurement",
        reference_id: input.procurement_id,
      }
    )
  }

  revalidatePath("/dashboard/procurement")
  return { error: null }
}

export async function advanceProcurementStage(
  procurementId: string,
  input: AdvanceStageInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase.schema("procurements").rpc(
    "advance_procurement_stage",
    {
      p_procurement_id: procurementId,
      p_next_stage: input.next_stage,
      p_notes: input.notes || null,
    }
  )

  if (error) return { error: error.message }

  revalidatePath("/dashboard/procurement")
  return { error: null }
}

export async function awardProcurement(
  input: AwardProcurementInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase.schema("procurements").rpc(
    "award_procurement",
    { p_procurement_id: input.procurement_id, p_bid_id: input.bid_id }
  )

  if (error) return { error: error.message }

  // Notify HOPE for award approval
  const meta = await getProcMeta(input.procurement_id)
  if (meta) {
    await notifyRoleInDivision(
      ["hope", "division_chief"],
      meta.division_id,
      {
        title: "Award Recommendation",
        message: `${meta.procurement_number} has an award recommendation pending your approval.`,
        type: "approval",
        reference_type: "procurement",
        reference_id: input.procurement_id,
      }
    )
  }

  revalidatePath("/dashboard/procurement")
  return { error: null }
}

export async function approveAward(
  procurementId: string,
  input: ApproveAwardInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase.schema("procurements").rpc(
    "approve_award",
    { p_procurement_id: procurementId, p_notes: input.notes || null }
  )

  if (error) return { error: error.message }

  // Notify Supply Officer + PR creator
  const meta = await getProcMeta(procurementId)
  if (meta) {
    await notifyRoleInDivision(
      ["supply_officer", "bac_secretariat"],
      meta.division_id,
      {
        title: "Award Approved",
        message: `The award for ${meta.procurement_number} has been approved.`,
        type: "success",
        reference_type: "procurement",
        reference_id: procurementId,
      }
    )

    // Notify PR creator directly
    if (meta.purchase_requests?.created_by) {
      await notifyUser(meta.purchase_requests.created_by, {
        title: "Procurement Award Approved",
        message: `The procurement for your Purchase Request (${meta.procurement_number}) has been awarded.`,
        type: "success",
        reference_type: "procurement",
        reference_id: procurementId,
      })
    }
  }

  revalidatePath("/dashboard/procurement")
  return { error: null }
}

export async function failProcurement(
  procurementId: string,
  input: FailProcurementInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase.schema("procurements").rpc(
    "fail_procurement",
    { p_procurement_id: procurementId, p_reason: input.reason }
  )

  if (error) return { error: error.message }

  // Notify Supply Officer
  const meta = await getProcMeta(procurementId)
  if (meta) {
    await notifyRoleInDivision(
      ["supply_officer", "bac_secretariat"],
      meta.division_id,
      {
        title: "Procurement Failed",
        message: `${meta.procurement_number} has been marked as failed: ${input.reason}`,
        type: "warning",
        reference_type: "procurement",
        reference_id: procurementId,
      }
    )
  }

  revalidatePath("/dashboard/procurement")
  return { error: null }
}
