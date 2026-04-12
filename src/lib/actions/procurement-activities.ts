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
  purchase_request:purchase_requests!procurement_activities_purchase_request_id_fkey(
    *,
    office:offices(id, name, code),
    fiscal_year:fiscal_years(id, year, status),
    fund_source:fund_sources(id, name, code),
    budget_allocation:budget_allocations(id, adjusted_amount, obligated_amount)
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

  if (error) {
    console.error("getProcurementActivityById error:", { id, error })
    return null
  }

  // Backfill requester separately — purchase_requests.requested_by FKs auth.users,
  // not user_profiles, so PostgREST cannot embed it.
  const activity = data as ProcurementActivityWithDetails
  const requesterId = activity.purchase_request?.requested_by
  if (requesterId) {
    const { data: requester } = await supabase
      .schema("procurements")
      .from("user_profiles")
      .select("id, first_name, last_name, position")
      .eq("id", requesterId)
      .maybeSingle()
    if (requester && activity.purchase_request) {
      activity.purchase_request.requester = requester as PurchaseRequestWithDetails["requester"]
    }
  }

  return activity
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
  if (isManager) stages.push(
    "rfq_preparation", "rfq_sent", "canvass_preparation", "canvass_sent",
    "bid_document_preparation", "pre_procurement_conference", "itb_published",
    "bid_submission", "noa_issued", "contract_signing", "ntp_issued"
  )
  if (isEvaluator) stages.push(
    "quotations_received", "canvass_received",
    "evaluation", "comparison", "abstract_prepared",
    "post_qualification",
    "pre_bid_conference", "bid_opening", "preliminary_examination",
    "technical_evaluation", "financial_evaluation", "bac_resolution"
  )
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
  canConfirm: boolean
  canRecommendAward: boolean
  canApproveAward: boolean
  canFail: boolean
  canAdvance: boolean
  canUploadResolution: boolean
}> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)

  const defaults = {
    canManage: false, canRecordBid: false, canEvaluate: false, canConfirm: false,
    canRecommendAward: false, canApproveAward: false, canFail: false, canAdvance: false,
    canUploadResolution: false,
  }

  if (!ctx) return defaults

  const { roleNames } = ctx

  // BAC Secretariat is now the sole scribe for procurement activities.
  // division_admin retains override access.
  const isSecretariat = roleNames.some(r =>
    ["bac_secretariat", "division_admin"].includes(r)
  )
  // BAC voting members — their only action is to Confirm the Secretariat's draft.
  const isConfirmer = roleNames.some(r =>
    ["bac_chair", "bac_member"].includes(r)
  ) || roleNames.includes("division_admin")
  const isApprover = roleNames.some(r =>
    ["hope", "division_chief", "division_admin"].includes(r)
  )

  return {
    canManage: isSecretariat,
    canRecordBid: isSecretariat,
    canEvaluate: isSecretariat,          // drafting the evaluation
    canConfirm: isConfirmer,              // confirming the Secretariat's draft
    canRecommendAward: isSecretariat,     // Secretariat enters the recommendation
    canApproveAward: isApprover,
    canFail: isSecretariat,
    canAdvance: isSecretariat,
    canUploadResolution: isSecretariat,
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
      pr_items:pr_items(
        id, app_item_id,
        app_item:app_items(id, general_description, procurement_mode, project_type)
      )
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
    .select("id, procurement_number, division_id, office_id, purchase_request_id, purchase_requests!procurement_activities_purchase_request_id_fkey(created_by)")
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
      p_lot_id: (input as { lot_id?: string }).lot_id ?? null,
      p_bid_security_amount: input.bid_security_amount ? parseFloat(input.bid_security_amount) : null,
      p_bid_security_form: input.bid_security_form || null,
      p_bid_security_reference: input.bid_security_reference || null,
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

  // Stage-specific notifications for competitive bidding
  const meta = await getProcMeta(procurementId)
  if (meta) {
    if (input.next_stage === "itb_published") {
      await notifyRoleInDivision(
        ["bac_chair", "bac_member", "bac_secretariat"],
        meta.division_id,
        {
          title: "ITB Published",
          message: `Invitation to Bid for ${meta.procurement_number} has been published on PhilGEPS.`,
          type: "info",
          reference_type: "procurement",
          reference_id: procurementId,
        }
      )
    } else if (input.next_stage === "bac_resolution") {
      await notifyRoleInDivision(
        ["hope", "division_chief"],
        meta.division_id,
        {
          title: "BAC Resolution Pending",
          message: `BAC resolution for ${meta.procurement_number} is being prepared. Award recommendation will follow.`,
          type: "info",
          reference_type: "procurement",
          reference_id: procurementId,
        }
      )
    } else if (input.next_stage === "noa_issued") {
      await notifyRoleInDivision(
        ["supply_officer", "bac_secretariat"],
        meta.division_id,
        {
          title: "Notice of Award Issued",
          message: `NOA for ${meta.procurement_number} has been issued to the winning bidder.`,
          type: "success",
          reference_type: "procurement",
          reference_id: procurementId,
        }
      )
    } else if (input.next_stage === "ntp_issued") {
      await notifyRoleInDivision(
        ["supply_officer"],
        meta.division_id,
        {
          title: "Notice to Proceed Issued",
          message: `NTP for ${meta.procurement_number} has been issued. Delivery/fulfillment may begin.`,
          type: "success",
          reference_type: "procurement",
          reference_id: procurementId,
        }
      )
    }
  }

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

export async function setPhilgepsReference(
  procurementId: string,
  philgepsReference: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const trimmed = philgepsReference.trim()
  if (trimmed.length < 3) {
    return { error: "PhilGEPS reference must be at least 3 characters" }
  }

  const { error } = await supabase
    .schema("procurements")
    .from("procurement_activities")
    .update({
      philgeps_reference: trimmed,
      philgeps_published_at: new Date().toISOString(),
    })
    .eq("id", procurementId)

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/procurement/activities/${procurementId}`)
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

// ============================================================
// BAC confirmation workflow
// ============================================================

/**
 * Fetch the calling user's active confirmation status for every bid in the
 * given procurement.
 */
export async function getMyBidConfirmationStatus(
  procurementId: string
): Promise<{
  hasConfirmed: boolean
  hasStaleConfirmation: boolean
  confirmedBidIds: Set<string>
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { hasConfirmed: false, hasStaleConfirmation: false, confirmedBidIds: new Set() }
  }

  const { data: bids } = await supabase
    .schema("procurements")
    .from("bids")
    .select("id")
    .eq("procurement_id", procurementId)
    .is("deleted_at", null)

  const bidIds = (bids ?? []).map((b: { id: string }) => b.id)
  if (bidIds.length === 0) {
    return { hasConfirmed: false, hasStaleConfirmation: false, confirmedBidIds: new Set() }
  }

  const { data: rows } = await supabase
    .schema("procurements")
    .from("bid_evaluations")
    .select("bid_id, status")
    .in("bid_id", bidIds)
    .eq("evaluator_id", user.id)

  const evalRows = (rows ?? []) as Array<{ bid_id: string; status: 'confirmed' | 'stale' }>
  const confirmedBidIds = new Set(
    evalRows.filter(r => r.status === "confirmed").map(r => r.bid_id)
  )
  const hasStaleConfirmation = evalRows.some(r => r.status === "stale")
  const hasConfirmed = confirmedBidIds.size > 0 && confirmedBidIds.size === bidIds.length

  return { hasConfirmed, hasStaleConfirmation, confirmedBidIds }
}

/**
 * Count the confirmations across the procurement so the UI can show
 * quorum progress (e.g., "2 of 3 BAC members have confirmed"). Reads
 * the required count from procurement_method_ceilings.min_bac_quorum
 * so adjusting the ceiling (e.g. to 2 for a small BAC) is reflected
 * in the UI without a code change.
 */
export async function getProcurementConfirmationProgress(
  procurementId: string
): Promise<{ confirmedMembers: number; required: number }> {
  const supabase = await createClient()

  // Fetch count and required in parallel
  const [countRes, activityRes] = await Promise.all([
    supabase
      .schema("procurements")
      .rpc("procurement_evaluator_count", { p_procurement_id: procurementId }),
    supabase
      .schema("procurements")
      .from("procurement_activities")
      .select("procurement_method")
      .eq("id", procurementId)
      .maybeSingle(),
  ])

  const confirmedMembers = (countRes.data as number) ?? 0

  let required = 0
  const method = activityRes.data?.procurement_method
  if (method) {
    const { data: ceiling } = await supabase
      .schema("procurements")
      .from("procurement_method_ceilings")
      .select("min_bac_quorum")
      .eq("procurement_mode", method)
      .maybeSingle()
    required = (ceiling?.min_bac_quorum as number | null) ?? 0
  }

  return { confirmedMembers, required }
}

/**
 * BAC voting member confirms the Secretariat's current evaluation draft.
 */
export async function confirmBidEvaluations(
  procurementId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("confirm_bid_evaluations", { p_procurement_id: procurementId })

  if (error) return { error: error.message }

  const meta = await getProcMeta(procurementId)
  if (meta) {
    await notifyRoleInDivision(
      ["bac_secretariat"],
      meta.division_id,
      {
        title: "BAC member confirmed evaluation",
        message: `A BAC member confirmed the evaluation draft for ${meta.procurement_number}.`,
        type: "info",
        reference_type: "procurement",
        reference_id: procurementId,
      }
    )
  }

  revalidatePath(`/dashboard/procurement/activities/${procurementId}`)
  revalidatePath(`/dashboard/procurement/activities/${procurementId}/evaluation`)
  return { error: null }
}

/**
 * BAC Secretariat uploads the signed BAC Resolution (number, date, file URL).
 * Required before advancing from bac_resolution → award_recommended.
 */
export async function uploadBacResolution(input: {
  procurement_id: string
  resolution_number: string
  resolution_date: string
  file_url: string
}): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("upload_bac_resolution", {
      p_procurement_id:    input.procurement_id,
      p_resolution_number: input.resolution_number,
      p_resolution_date:   input.resolution_date,
      p_file_url:          input.file_url,
    })

  if (error) return { error: error.message }

  const meta = await getProcMeta(input.procurement_id)
  if (meta) {
    await notifyRoleInDivision(
      ["bac_chair", "bac_member", "hope"],
      meta.division_id,
      {
        title: "BAC Resolution uploaded",
        message: `The BAC Resolution for ${meta.procurement_number} has been uploaded.`,
        type: "info",
        reference_type: "procurement",
        reference_id: input.procurement_id,
      }
    )
  }

  revalidatePath(`/dashboard/procurement/activities/${input.procurement_id}`)
  return { error: null }
}

export type ProcurementDocumentType =
  | "bac_resolution"
  | "noa"
  | "signed_contract"
  | "ntp"

const DOC_TYPE_LABELS: Record<ProcurementDocumentType, string> = {
  bac_resolution:  "BAC Resolution",
  noa:             "Notice of Award",
  signed_contract: "Signed Contract",
  ntp:             "Notice to Proceed",
}

/**
 * Persist a storage path onto procurement_activities after the client has
 * finished uploading the file directly to the procurement-documents bucket.
 */
export async function setProcurementDocumentPath(input: {
  procurement_id: string
  doc_type: ProcurementDocumentType
  path: string
}): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("set_procurement_document_url", {
      p_procurement_id: input.procurement_id,
      p_doc_type:       input.doc_type,
      p_file_url:       input.path,
    })

  if (error) return { error: error.message }

  const meta = await getProcMeta(input.procurement_id)
  if (meta) {
    await notifyRoleInDivision(
      ["bac_chair", "bac_member", "hope"],
      meta.division_id,
      {
        title: `${DOC_TYPE_LABELS[input.doc_type]} uploaded`,
        message: `The ${DOC_TYPE_LABELS[input.doc_type]} for ${meta.procurement_number} has been uploaded.`,
        type: "info",
        reference_type: "procurement",
        reference_id: input.procurement_id,
      }
    )
  }

  revalidatePath(`/dashboard/procurement/activities/${input.procurement_id}`)
  return { error: null }
}

/**
 * Returns the current user's division UUID so client components can build
 * the storage path convention `{division_id}/{procurement_id}/…`.
 */
export async function getMyDivisionId(): Promise<string | null> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile = ctx?.profile as any
  return profile?.division_id ?? null
}

export type PerformanceSecurityForm =
  | "cash"
  | "bank_draft"
  | "managers_check"
  | "irrevocable_loc"
  | "surety_bond"
  | "bank_guarantee"

/**
 * BAC Secretariat records the winning bidder's performance security so the
 * procurement can advance from noa_issued → contract_signing.
 */
export async function recordPerformanceSecurity(input: {
  procurement_id: string
  amount: string
  form: PerformanceSecurityForm
  reference: string
}): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("record_performance_security", {
      p_procurement_id: input.procurement_id,
      p_amount:         parseFloat(input.amount),
      p_form:           input.form,
      p_reference:      input.reference,
    })

  if (error) return { error: error.message }

  const meta = await getProcMeta(input.procurement_id)
  if (meta) {
    await notifyRoleInDivision(
      ["bac_chair", "bac_member", "hope"],
      meta.division_id,
      {
        title: "Performance security recorded",
        message: `The winning bidder's performance security for ${meta.procurement_number} has been recorded. The procurement can now advance to Contract Signing.`,
        type: "info",
        reference_type: "procurement",
        reference_id: input.procurement_id,
      }
    )
  }

  revalidatePath(`/dashboard/procurement/activities/${input.procurement_id}`)
  return { error: null }
}
