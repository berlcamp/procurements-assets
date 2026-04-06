"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type {
  Supplier,
  PurchaseRequest,
  PurchaseRequestWithDetails,
  PrItem,
  ObligationRequest,
  ProcurementDashboardStats,
  SplitContractWarning,
  AppItem,
  AppLot,
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
// Helpers
// ============================================================

type UserRoleRow = { role: { name: string } | null; office_id: string | null }

async function getUserRoleContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: profile }, { data: rolesData }] = await Promise.all([
    supabase.schema("procurements").from("user_profiles")
      .select("office_id, division_id")
      .eq("id", user.id)
      .single(),
    supabase.schema("procurements").from("user_roles")
      .select("role:roles(name), office_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .is("revoked_at", null),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roles = (rolesData ?? []) as any[] as UserRoleRow[]
  const roleNames = roles.map(r => r.role?.name).filter((n): n is string => !!n)

  return { user, profile, roleNames }
}

type NotificationInsert = {
  title: string
  message: string
  type: "info" | "success" | "warning" | "error" | "approval"
  reference_type: string
  reference_id: string
}

async function notifyRoleInOffice(roleNames: string[], officeId: string, notification: NotificationInsert) {
  const admin = createAdminClient()
  const { data: userRoles } = await admin
    .schema("procurements")
    .from("user_roles")
    .select("user_id, role:roles!inner(name)")
    .in("role.name" as string, roleNames)
    .eq("office_id", officeId)
    .eq("is_active", true)
    .is("revoked_at", null)
  if (!userRoles?.length) return
  const inserts = userRoles.map((r: { user_id: string }) => ({ user_id: r.user_id, ...notification }))
  await admin.schema("procurements").from("notifications").insert(inserts)
}

async function notifyRoleInDivision(roleNames: string[], divisionId: string, notification: NotificationInsert) {
  const admin = createAdminClient()
  const { data: userRoles } = await admin
    .schema("procurements")
    .from("user_roles")
    .select("user_id, role:roles!inner(name)")
    .in("role.name" as string, roleNames)
    .eq("division_id", divisionId)
    .eq("is_active", true)
    .is("revoked_at", null)
  if (!userRoles?.length) return
  const inserts = userRoles.map((r: { user_id: string }) => ({ user_id: r.user_id, ...notification }))
  await admin.schema("procurements").from("notifications").insert(inserts)
}

async function notifyUser(userId: string, notification: NotificationInsert) {
  const admin = createAdminClient()
  await admin.schema("procurements").from("notifications").insert({ user_id: userId, ...notification })
}

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
  budget_allocation:budget_allocations(id, adjusted_amount, obligated_amount),
  app_item:app_items(id, item_number, general_description, estimated_budget, procurement_mode, project_type, source_of_funds, procurement_start, procurement_end, delivery_period),
  lot:app_lots(id, lot_name, lot_number)
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
      .select("*")
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
): Promise<(AppItem & { lot?: Pick<AppLot, 'id' | 'lot_name' | 'lot_number'> | null })[]> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)
  if (!ctx) return []

  const { roleNames } = ctx
  const canViewAll = roleNames.some(r =>
    ["division_admin", "hope", "division_chief", "section_chief", "budget_officer", "supply_officer", "auditor", "bac_chair", "bac_secretariat"].includes(r)
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
    .select("*, lot:app_lots(id, lot_name, lot_number)")
    .in("app_id", appIds)
    .eq("hope_review_status", "approved")
    .is("deleted_at", null)
    .order("item_number")

  if (!canViewAll) {
    query = query.eq("source_office_id", officeId)
  }

  const { data, error } = await query
  if (error) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as any[]
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
      p_app_item_id:    input.app_item_id,
      p_purpose:        input.purpose,
      p_fiscal_year_id: input.fiscal_year_id,
      p_items:          input.items,
    })

  if (error) return { id: null, error: error.message }

  revalidatePath("/dashboard/procurement/purchase-requests")
  return { id: data as string, error: null }
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
