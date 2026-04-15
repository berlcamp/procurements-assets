"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type {
  Supplier,
  PurchaseRequestWithDetails,
  PrItem,
  ObligationRequest,
  ProcurementDashboardStats,
  SplitContractWarning,
  AppItem,
  AppLot,
  PpmpLotItem,
  Office,
} from "@/types/database"
import type {
  SupplierInput,
  SupplierBlacklistInput,
  CreatePrInput,
  UpdatePrItemsInput,
  PrCertifyInput,
  PrApproveInput,
  PrReturnInput,
  PrCancelInput,
} from "@/lib/schemas/procurement"

// ============================================================
// Helpers (shared — re-exported from helpers.ts)
// ============================================================

import {
  getUserRoleContext,
  notifyRoleInDivision,
  notifyUser,
} from "@/lib/actions/helpers"

async function getPrMeta(prId: string): Promise<{ officeId: string | null; divisionId: string | null; createdBy: string | null } | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("procurements")
    .from("purchase_requests")
    .select("office_id, division_id, created_by")
    .eq("id", prId)
    .single()
  if (!data) return null
  return { officeId: data.office_id, divisionId: data.division_id, createdBy: data.created_by }
}

// ============================================================
// Supplier queries
// ============================================================

export async function getSuppliers(
  search?: string,
  status?: string
): Promise<Supplier[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("suppliers")
    .select("*")
    .is("deleted_at", null)
    .order("name")

  if (status) query = query.eq("status", status)

  const { data, error } = await query
  if (error) {
    console.error("getSuppliers error:", error)
    return []
  }

  const suppliers = (data ?? []) as Supplier[]

  if (search) {
    const q = search.toLowerCase()
    return suppliers.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        s.tin.toLowerCase().includes(q) ||
        (s.philgeps_number ?? "").toLowerCase().includes(q) ||
        (s.trade_name ?? "").toLowerCase().includes(q)
    )
  }

  return suppliers
}

export async function getSupplierById(id: string): Promise<Supplier | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) return null
  return data as Supplier
}

export async function getSupplierStats(): Promise<{ active: number; blacklisted: number; total: number }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("suppliers")
    .select("status")
    .is("deleted_at", null)

  if (error) return { active: 0, blacklisted: 0, total: 0 }

  const rows = (data ?? []) as { status: string }[]
  return {
    total:       rows.length,
    active:      rows.filter(r => r.status === "active").length,
    blacklisted: rows.filter(r => r.status === "blacklisted").length,
  }
}

// ============================================================
// Supplier mutations
// ============================================================

export async function createSupplier(
  input: SupplierInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { id: null, error: "Unauthorized" }

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .single()

  if (!profile?.division_id) return { id: null, error: "No division assigned" }

  const { data, error } = await supabase
    .schema("procurements")
    .from("suppliers")
    .insert({ ...input, division_id: profile.division_id, created_by: user.id })
    .select("id")
    .single()

  if (error) return { id: null, error: error.message }

  revalidatePath("/dashboard/procurement/suppliers")
  return { id: (data as { id: string }).id, error: null }
}

export async function updateSupplier(
  id: string,
  input: SupplierInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("suppliers")
    .update(input)
    .eq("id", id)
    .is("deleted_at", null)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/procurement/suppliers")
  revalidatePath(`/dashboard/procurement/suppliers/${id}`)
  return { error: null }
}

export async function blacklistSupplier(
  id: string,
  input: SupplierBlacklistInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("suppliers")
    .update({
      status:           "blacklisted",
      blacklist_reason: input.blacklist_reason,
      blacklist_date:   input.blacklist_date,
      blacklist_until:  input.blacklist_until ?? null,
    })
    .eq("id", id)
    .is("deleted_at", null)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/procurement/suppliers")
  revalidatePath(`/dashboard/procurement/suppliers/${id}`)
  return { error: null }
}

export async function activateSupplier(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("suppliers")
    .update({
      status:           "active",
      blacklist_reason: null,
      blacklist_date:   null,
      blacklist_until:  null,
    })
    .eq("id", id)
    .is("deleted_at", null)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/procurement/suppliers")
  revalidatePath(`/dashboard/procurement/suppliers/${id}`)
  return { error: null }
}

// ============================================================
// PR queries
// ============================================================

const PR_SELECT = `
  *,
  office:offices(id, name, code),
  fiscal_year:fiscal_years(id, year, status),
  fund_source:fund_sources(id, name, code),
  budget_allocation:budget_allocations(id, adjusted_amount, obligated_amount)
` as const

export async function getPurchaseRequests(
  fiscalYearId?: string
): Promise<PurchaseRequestWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("purchase_requests")
    .select(PR_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId)

  const { data, error } = await query
  if (error) {
    console.error("getPurchaseRequests error:", error)
    return []
  }
  return (data ?? []) as PurchaseRequestWithDetails[]
}

export async function getAllDivisionPrs(
  fiscalYearId?: string
): Promise<PurchaseRequestWithDetails[] | null> {
  const supabase = await createClient()

  const { data: hasPermission, error: permError } = await supabase
    .schema("procurements")
    .rpc("has_permission", { p_permission_code: "ppmp.view_all" })

  if (permError) {
    console.error("getAllDivisionPrs permission check error:", permError)
    return null
  }
  if (!hasPermission) return null

  const ctx = await getUserRoleContext(supabase)
  const isAuditor = ctx?.roleNames.includes("auditor") ?? false

  let query = supabase
    .schema("procurements")
    .from("purchase_requests")
    .select(PR_SELECT)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })

  if (!isAuditor) {
    query = query.neq("status", "draft")
  }
  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId)

  const { data, error } = await query
  if (error) {
    console.error("getAllDivisionPrs error:", error)
    return []
  }
  return (data ?? []) as PurchaseRequestWithDetails[]
}

export async function getPurchaseRequestById(
  id: string
): Promise<PurchaseRequestWithDetails | null> {
  const supabase = await createClient()

  const { data: pr, error } = await supabase
    .schema("procurements")
    .from("purchase_requests")
    .select(PR_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error || !pr) return null

  // Fetch items, OBR, and requester profile in parallel
  const prData = pr as PurchaseRequestWithDetails
  const [{ data: items }, { data: obr }, { data: requester }] = await Promise.all([
    supabase
      .schema("procurements")
      .from("pr_items")
      .select(`
        *,
        app_item:app_items(
          id, item_number, general_description, estimated_budget,
          procurement_mode, project_type, source_of_funds
        )
      `)
      .eq("purchase_request_id", id)
      .is("deleted_at", null)
      .order("item_number"),
    supabase
      .schema("procurements")
      .from("obligation_requests")
      .select("*")
      .eq("purchase_request_id", id)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .maybeSingle(),
    prData.created_by
      ? supabase
          .schema("procurements")
          .from("user_profiles")
          .select("id, first_name, last_name, position")
          .eq("id", prData.created_by)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return {
    ...prData,
    pr_items: (items ?? []) as PrItem[],
    obr: obr as ObligationRequest | null,
    requester: requester as PurchaseRequestWithDetails["requester"],
  }
}

export async function getMyPrs(
  fiscalYearId?: string
): Promise<PurchaseRequestWithDetails[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  let query = supabase
    .schema("procurements")
    .from("purchase_requests")
    .select(PR_SELECT)
    .eq("created_by", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId)

  const { data, error } = await query
  if (error) return []
  return (data ?? []) as PurchaseRequestWithDetails[]
}

export async function getPrsRequiringMyAction(): Promise<PurchaseRequestWithDetails[]> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)
  if (!ctx) return []

  const { roleNames } = ctx

  const isCertifier = roleNames.some(r => ["budget_officer", "division_admin"].includes(r))
  const isApprover  = roleNames.some(r => ["hope", "division_chief", "school_head", "division_admin"].includes(r))

  if (!isCertifier && !isApprover) return []

  const statuses: string[] = []
  if (isCertifier) statuses.push("submitted")
  if (isApprover)  statuses.push("budget_certified")

  const { data, error } = await supabase
    .schema("procurements")
    .from("purchase_requests")
    .select(PR_SELECT)
    .in("status", statuses)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) return []
  return (data ?? []) as PurchaseRequestWithDetails[]
}

export async function getPrUserPermissions(prId: string): Promise<{
  canCreate: boolean
  canEdit: boolean
  canSubmit: boolean
  canCertify: boolean
  canApprove: boolean
  canCancel: boolean
  isOwner: boolean
}> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)

  const defaults = {
    canCreate: false, canEdit: false, canSubmit: false,
    canCertify: false, canApprove: false, canCancel: false, isOwner: false,
  }

  if (!ctx) return defaults

  const { user, roleNames } = ctx

  // Check PR ownership
  const { data: pr } = await supabase
    .schema("procurements")
    .from("purchase_requests")
    .select("created_by, status")
    .eq("id", prId)
    .single()

  const isOwner = pr?.created_by === user.id

  const isEndUser     = roleNames.some(r => ["end_user", "school_head", "bac_secretariat", "supply_officer"].includes(r))
  const isCertifier   = roleNames.some(r => ["budget_officer", "division_admin"].includes(r))
  const isApprover    = roleNames.some(r => ["hope", "division_chief", "school_head", "division_admin"].includes(r))
  const isAdmin       = roleNames.includes("division_admin")

  return {
    canCreate:  isEndUser || isAdmin,
    canEdit:    (isOwner && pr?.status === "draft") || isAdmin,
    canSubmit:  isOwner || isAdmin,
    canCertify: isCertifier,
    canApprove: isApprover,
    canCancel:  isOwner || isApprover || isAdmin,
    isOwner,
  }
}

export async function getApprovedAppItemsForOffice(
  officeId: string,
  fiscalYearId: string
): Promise<(AppItem & {
  lot?: Pick<AppLot, 'id' | 'lot_name' | 'lot_number'> | null
  source_ppmp_lot?: { ppmp_lot_items: Pick<PpmpLotItem, 'id' | 'item_number' | 'description' | 'quantity' | 'unit' | 'estimated_unit_cost' | 'estimated_total_cost' | 'specification'>[] } | null
  ppmp_creator_name?: string | null
  has_active_pr?: boolean
  active_pr_number?: string | null
})[]> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)
  if (!ctx) return []

  const { roleNames } = ctx
  const canViewAll = roleNames.some(r =>
    ["division_admin", "hope", "division_chief", "section_chief", "budget_officer", "supply_officer", "auditor", "bac_chair", "bac_vice_chair", "bac_secretariat"].includes(r)
  )

  const { data: apps, error: appErr } = await supabase
    .schema("procurements")
    .from("apps")
    .select("id")
    .in("status", ["approved", "posted"])
    .eq("fiscal_year_id", fiscalYearId)
    .is("deleted_at", null)

  if (appErr || !apps?.length) return []

  const appIds = apps.map(a => a.id)

  let query = supabase
    .schema("procurements")
    .from("app_items")
    .select(`
      *,
      lot:app_lots(id, lot_name, lot_number),
      source_ppmp_lot:ppmp_lots!app_items_source_ppmp_lot_id_fkey(
        ppmp_lot_items(id, item_number, description, quantity, unit, estimated_unit_cost, estimated_total_cost, specification)
      )
    `)
    .in("app_id", appIds)
    .eq("hope_review_status", "approved")
    .is("deleted_at", null)
    .order("item_number")

  if (!canViewAll) {
    query = query.eq("source_office_id", officeId)
  }

  const { data, error } = await query
  if (error) return []

  const items = (data ?? []) as Array<Record<string, unknown> & { id: string; source_ppmp_id: string | null }>
  if (items.length === 0) return []

  // Find which items already have an active PR (not cancelled, not soft-deleted).
  // The link is through pr_items.app_item_id → purchase_requests (legacy column was dropped).
  const itemIds = items.map(i => i.id)
  const { data: takenRows } = await supabase
    .schema("procurements")
    .from("pr_items")
    .select("app_item_id, purchase_request:purchase_requests!inner(id, pr_number, status)")
    .in("app_item_id", itemIds)
    .is("deleted_at", null)
    .neq("purchase_request.status", "cancelled" as never)
    .is("purchase_request.deleted_at" as never, null)

  // Build a map: app_item_id → pr_number of the first active PR found
  const takenMap = new Map<string, string>()
  for (const row of takenRows ?? []) {
    const appItemId = row.app_item_id as string
    if (!takenMap.has(appItemId)) {
      const pr = row.purchase_request as unknown as { pr_number: string }
      takenMap.set(appItemId, pr.pr_number)
    }
  }

  // Enrich with PPMP creator name
  const ppmpIds = [...new Set(items.map(i => i.source_ppmp_id).filter((id): id is string => !!id))]
  const creatorByPpmpId = new Map<string, string>()

  if (ppmpIds.length > 0) {
    const { data: ppmps } = await supabase
      .schema("procurements")
      .from("ppmps")
      .select("id, created_by")
      .in("id", ppmpIds)

    if (ppmps?.length) {
      const creatorIds = [...new Set(ppmps.map(p => p.created_by).filter((id): id is string => !!id))]
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .schema("procurements")
          .from("user_profiles")
          .select("id, first_name, last_name")
          .in("id", creatorIds)

        const profileById = new Map(
          (profiles ?? []).map((p: { id: string; first_name: string; last_name: string }) => [
            p.id,
            [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "—",
          ])
        )
        for (const ppmp of ppmps) {
          if (ppmp.created_by) {
            creatorByPpmpId.set(ppmp.id as string, profileById.get(ppmp.created_by as string) ?? "")
          }
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return items.map(i => ({
    ...i,
    has_active_pr: takenMap.has(i.id),
    active_pr_number: takenMap.get(i.id) ?? null,
    ppmp_creator_name: (i.source_ppmp_id && creatorByPpmpId.get(i.source_ppmp_id)) || null,
  })) as any[]
}

export async function getProcurementDashboardStats(
  fiscalYearId: string
): Promise<ProcurementDashboardStats | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_pr_summary", { p_fiscal_year_id: fiscalYearId })

  if (error) {
    console.error("getProcurementDashboardStats error:", error)
    return null
  }
  return data as ProcurementDashboardStats
}

// ============================================================
// PR mutations
// ============================================================

export async function createPurchaseRequest(
  input: CreatePrInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("create_purchase_request", {
      p_office_id:      input.office_id,
      p_purpose:        input.purpose,
      p_fiscal_year_id: input.fiscal_year_id,
      p_items:          input.items,
    })

  if (error) return { id: null, error: error.message }

  revalidatePath("/dashboard/procurement/purchase-requests")
  return { id: data as string, error: null }
}

export async function addPrItem(
  prId: string,
  input: {
    app_item_id: string
    description: string
    unit: string
    quantity: string
    estimated_unit_cost: string
    remarks?: string | null
  }
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("add_pr_item", {
      p_pr_id:               prId,
      p_app_item_id:         input.app_item_id,
      p_description:         input.description,
      p_unit:                input.unit,
      p_quantity:            parseFloat(input.quantity),
      p_estimated_unit_cost: parseFloat(input.estimated_unit_cost),
      p_remarks:             input.remarks ?? null,
    })

  if (error) return { id: null, error: error.message }
  revalidatePath(`/dashboard/procurement/purchase-requests/${prId}`)
  return { id: data as string, error: null }
}

export async function removePrItem(
  prItemId: string,
  prId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("remove_pr_item", { p_pr_item_id: prItemId })

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/procurement/purchase-requests/${prId}`)
  return { error: null }
}

export async function updatePrItem(
  prItemId: string,
  prId: string,
  input: {
    description: string
    unit: string
    quantity: string
    estimated_unit_cost: string
    remarks?: string | null
  }
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("update_pr_item", {
      p_pr_item_id:          prItemId,
      p_description:         input.description,
      p_unit:                input.unit,
      p_quantity:            parseFloat(input.quantity),
      p_estimated_unit_cost: parseFloat(input.estimated_unit_cost),
      p_remarks:             input.remarks ?? null,
    })

  if (error) return { error: error.message }
  revalidatePath(`/dashboard/procurement/purchase-requests/${prId}`)
  return { error: null }
}

export async function updatePrItems(
  prId: string,
  input: UpdatePrItemsInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("update_pr_items", {
      p_pr_id:  prId,
      p_items:  input.items,
    })

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/procurement/purchase-requests/${prId}`)
  return { error: null }
}

export async function submitPurchaseRequest(
  prId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("submit_purchase_request", { p_pr_id: prId })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/procurement/purchase-requests")
  revalidatePath(`/dashboard/procurement/purchase-requests/${prId}`)

  const meta = await getPrMeta(prId)
  if (meta?.divisionId) {
    notifyRoleInDivision(["budget_officer"], meta.divisionId, {
      title: "Purchase Request Awaiting Certification",
      message: "A Purchase Request has been submitted and requires budget availability certification.",
      type: "approval",
      reference_type: "purchase_request",
      reference_id: prId,
    })
  }

  return { error: null }
}

export async function certifyBudgetAvailability(
  prId: string,
  input: PrCertifyInput
): Promise<{ obrNumber: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("certify_budget_availability", {
      p_pr_id:   prId,
      p_remarks: input.remarks ?? null,
    })

  if (error) return { obrNumber: null, error: error.message }

  revalidatePath("/dashboard/procurement/purchase-requests")
  revalidatePath(`/dashboard/procurement/purchase-requests/${prId}`)

  const meta = await getPrMeta(prId)
  if (meta?.divisionId) {
    notifyRoleInDivision(["hope", "division_chief", "school_head"], meta.divisionId, {
      title: "Purchase Request Awaiting Approval",
      message: "Budget availability has been certified. The Purchase Request is ready for approval.",
      type: "approval",
      reference_type: "purchase_request",
      reference_id: prId,
    })
  }

  return { obrNumber: data as string, error: null }
}

export async function approvePurchaseRequest(
  prId: string,
  input: PrApproveInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("approve_purchase_request", {
      p_pr_id:   prId,
      p_remarks: input.remarks ?? null,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/procurement/purchase-requests")
  revalidatePath(`/dashboard/procurement/purchase-requests/${prId}`)

  const meta = await getPrMeta(prId)
  if (meta?.createdBy) {
    notifyUser(meta.createdBy, {
      title: "Purchase Request Approved",
      message: "Your Purchase Request has been approved and is now in procurement.",
      type: "success",
      reference_type: "purchase_request",
      reference_id: prId,
    })
  }

  return { error: null }
}

export async function returnPrToEndUser(
  prId: string,
  input: PrReturnInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("return_pr_to_end_user", {
      p_pr_id:  prId,
      p_reason: input.reason,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/procurement/purchase-requests")
  revalidatePath(`/dashboard/procurement/purchase-requests/${prId}`)

  const meta = await getPrMeta(prId)
  if (meta?.createdBy) {
    notifyUser(meta.createdBy, {
      title: "Purchase Request Returned",
      message: `Your Purchase Request has been returned for revision. Reason: ${input.reason}`,
      type: "warning",
      reference_type: "purchase_request",
      reference_id: prId,
    })
  }

  return { error: null }
}

export async function cancelPurchaseRequest(
  prId: string,
  input: PrCancelInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("cancel_purchase_request", {
      p_pr_id:  prId,
      p_reason: input.cancellation_reason,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/procurement/purchase-requests")
  revalidatePath(`/dashboard/procurement/purchase-requests/${prId}`)
  return { error: null }
}

export async function checkSplitContract(
  officeId: string,
  category: string,
  amount: number
): Promise<SplitContractWarning | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("check_split_contract", {
      p_office_id: officeId,
      p_category:  category,
      p_amount:    amount,
    })

  if (error) return null
  return data as SplitContractWarning
}

// ============================================================
// Offices helper (for PR form office selector)
// ============================================================

export async function getOfficesForUser(): Promise<Office[]> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)
  if (!ctx) return []

  const { roleNames, profile } = ctx
  const canViewAll = roleNames.some(r =>
    ["division_admin", "hope", "division_chief", "budget_officer", "supply_officer"].includes(r)
  )

  let query = supabase
    .schema("procurements")
    .from("offices")
    .select("*")
    .is("deleted_at", null)
    .order("name")

  if (!canViewAll && profile?.office_id) {
    query = query.eq("id", profile.office_id)
  }

  const { data, error } = await query
  if (error) return []
  return (data ?? []) as Office[]
}
