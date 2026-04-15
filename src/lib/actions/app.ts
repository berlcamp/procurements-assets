"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  App,
  AppWithDetails,
  AppVersion,
  AppItem,
  AppItemWithOffice,
  AppLot,
  AppLotWithItems,
  AppSummary,
} from "@/types/database"
import type { AppLotInput, AppHopeReviewInput } from "@/lib/schemas/app"
import { notifyRoleInDivision, notifyUser } from "@/lib/actions/helpers"

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

async function getAppDivisionId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  appId: string
): Promise<string | null> {
  const { data } = await supabase
    .schema("procurements")
    .from("apps")
    .select("division_id")
    .eq("id", appId)
    .single()
  return data?.division_id ?? null
}

async function getAppIdFromItemId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  appItemId: string
): Promise<string | null> {
  const { data: item } = await supabase
    .schema("procurements")
    .from("app_items")
    .select("app_version_id")
    .eq("id", appItemId)
    .single()
  if (!item) return null
  const { data: version } = await supabase
    .schema("procurements")
    .from("app_versions")
    .select("app_id")
    .eq("id", item.app_version_id)
    .single()
  return version?.app_id ?? null
}

const LOTS_LOCKED_STATUSES = ["final", "approved", "posted"]

async function isAppLotsLocked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  appId: string
): Promise<boolean> {
  const { data } = await supabase
    .schema("procurements")
    .from("apps")
    .select("status")
    .eq("id", appId)
    .single()
  return LOTS_LOCKED_STATUSES.includes(data?.status ?? "")
}

async function isAppLotsLockedByLot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lotId: string
): Promise<boolean> {
  const { data: lot } = await supabase
    .schema("procurements")
    .from("app_lots")
    .select("app_version_id")
    .eq("id", lotId)
    .single()
  if (!lot) return true
  const { data: version } = await supabase
    .schema("procurements")
    .from("app_versions")
    .select("app_id")
    .eq("id", lot.app_version_id)
    .single()
  if (!version) return true
  return isAppLotsLocked(supabase, version.app_id)
}

async function isAppLotsLockedByItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  appItemId: string
): Promise<boolean> {
  const { data: item } = await supabase
    .schema("procurements")
    .from("app_items")
    .select("app_version_id")
    .eq("id", appItemId)
    .single()
  if (!item) return true
  const { data: version } = await supabase
    .schema("procurements")
    .from("app_versions")
    .select("app_id")
    .eq("id", item.app_version_id)
    .single()
  if (!version) return true
  return isAppLotsLocked(supabase, version.app_id)
}

// ============================================================
// APP queries
// ============================================================

const APP_SELECT = `
  *,
  fiscal_year:fiscal_years(id, year, status)
` as const

export async function getApps(
  fiscalYearId?: string
): Promise<AppWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("apps")
    .select(APP_SELECT)
    .order("created_at", { ascending: false })

  if (fiscalYearId) {
    query = query.eq("fiscal_year_id", fiscalYearId)
  }

  const { data, error } = await query
  if (error) {
    console.error("getApps error:", error)
    return []
  }
  return (data ?? []) as AppWithDetails[]
}

export async function getAppById(
  id: string
): Promise<AppWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("apps")
    .select(APP_SELECT)
    .eq("id", id)
    .single()

  if (error) return null
  return data as AppWithDetails
}

export async function getCurrentAppVersion(
  appId: string
): Promise<AppVersion | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("app_versions")
    .select("*")
    .eq("app_id", appId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single()

  if (error) return null
  return data as AppVersion
}

export async function getAppItems(
  appVersionId: string
): Promise<AppItemWithOffice[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("app_items")
    .select(`
      *,
      source_office:offices!app_items_source_office_id_fkey(id, name, code),
      lot:app_lots!fk_app_items_lot_id(id, lot_name, lot_number),
      source_ppmp_lot:ppmp_lots!app_items_source_ppmp_lot_id_fkey(
        lot_number,
        lot_title,
        ppmp_lot_items(id, item_number, description, quantity, unit, estimated_unit_cost, estimated_total_cost, specification)
      )
    `)
    .eq("app_version_id", appVersionId)
    .order("item_number", { ascending: true })

  if (error) {
    console.error("getAppItems error:", error)
    return []
  }
  return (data ?? []) as AppItemWithOffice[]
}

export async function getAppLots(
  appVersionId: string
): Promise<AppLotWithItems[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("app_lots")
    .select(`
      *,
      app_items(*)
    `)
    .eq("app_version_id", appVersionId)
    .is("deleted_at", null)
    .order("lot_number", { ascending: true })

  if (error) {
    console.error("getAppLots error:", error)
    return []
  }

  const lots = (data ?? []) as AppLotWithItems[]
  for (const lot of lots) {
    if (lot.app_items) {
      lot.app_items = lot.app_items
        .sort((a: AppItem, b: AppItem) => (a.lot_item_number ?? 0) - (b.lot_item_number ?? 0))
    }
  }
  return lots
}

export async function getAppSummary(
  appId: string
): Promise<AppSummary | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_app_summary", { p_app_id: appId })

  if (error) {
    console.error("getAppSummary error:", error)
    return null
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return row as AppSummary
}

export async function getAppVersionHistory(
  appId: string
): Promise<AppVersion[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("app_versions")
    .select("*")
    .eq("app_id", appId)
    .order("version_number", { ascending: false })

  if (error) {
    console.error("getAppVersionHistory error:", error)
    return []
  }
  return (data ?? []) as AppVersion[]
}

// ============================================================
// APP context-aware queries
// ============================================================

export async function getAppUserPermissions(appId: string): Promise<{
  canHopeReview: boolean
  canViewLots: boolean
  canManageLots: boolean
  canFinalizeLot: boolean
  canFinalizeApp: boolean
  canApproveApp: boolean
}> {
  const supabase = await createClient()
  const [ctx, { data: app }] = await Promise.all([
    getUserRoleContext(supabase),
    supabase.schema("procurements").from("apps").select("status").eq("id", appId).single(),
  ])
  if (!ctx) return { canHopeReview: false, canViewLots: false, canManageLots: false, canFinalizeLot: false, canFinalizeApp: false, canApproveApp: false }

  const { roleNames } = ctx
  const isHope = roleNames.includes("hope") || roleNames.includes("division_admin")
  const isBac = roleNames.some(r => ["bac_chair", "bac_vice_chair", "bac_member", "bac_secretariat", "division_admin"].includes(r))
  const canFinalizeLotRole = roleNames.some(r => ["bac_chair", "bac_vice_chair", "bac_secretariat", "division_admin"].includes(r))

  // Lot editing is locked once the APP reaches final or beyond
  const lotsLocked = LOTS_LOCKED_STATUSES.includes(app?.status ?? "")

  return {
    canHopeReview: isHope,
    canViewLots: isHope || isBac,
    canManageLots: isBac && !lotsLocked,
    canFinalizeLot: canFinalizeLotRole && !lotsLocked,
    canFinalizeApp: isHope,
    canApproveApp: isHope,
  }
}

// ============================================================
// APP action queue (items requiring the current user's attention)
// ============================================================

export async function getAppsRequiringMyAction(
  fiscalYearId?: string
): Promise<AppWithDetails[]> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)
  if (!ctx) return []

  const { roleNames } = ctx

  const isHope = roleNames.includes("hope") || roleNames.includes("division_admin")
  const isBac = roleNames.some(r =>
    ["bac_chair", "bac_vice_chair", "bac_member", "bac_secretariat"].includes(r)
  )

  if (!isHope && !isBac) return []

  // Status-based action queue (existing workflow logic)
  const hopeStatuses = ["indicative", "under_review", "bac_finalization", "final"]
  const bacStatuses = ["bac_finalization"]
  const statuses = isHope ? hopeStatuses : bacStatuses

  let query = supabase
    .schema("procurements")
    .from("apps")
    .select(APP_SELECT)
    .in("status", statuses)
    .order("updated_at", { ascending: false })

  if (fiscalYearId) {
    query = query.eq("fiscal_year_id", fiscalYearId)
  }

  const { data, error } = await query
  if (error) {
    console.error("getAppsRequiringMyAction error:", error)
    return []
  }

  let results = (data ?? []) as AppWithDetails[]

  // For BAC roles, also surface APPs that have:
  // 1) HOPE-approved items not yet assigned to a lot, OR
  // 2) Lots still in draft (not yet finalized)
  if (isBac) {
    const [{ data: unassigned }, { data: draftLots }] = await Promise.all([
      supabase
        .schema("procurements")
        .from("app_items")
        .select("app_version_id")
        .eq("hope_review_status", "approved")
        .is("lot_id", null),
      supabase
        .schema("procurements")
        .from("app_lots")
        .select("app_version_id")
        .eq("status", "draft")
        .is("deleted_at", null),
    ])

    const versionIdsFromItems = (unassigned ?? []).map(i => i.app_version_id)
    const versionIdsFromLots = (draftLots ?? []).map(l => l.app_version_id)
    const allVersionIds = [...new Set([...versionIdsFromItems, ...versionIdsFromLots])]

    if (allVersionIds.length) {
      const { data: versions } = await supabase
        .schema("procurements")
        .from("app_versions")
        .select("app_id")
        .in("id", allVersionIds)

      if (versions?.length) {
        const existingIds = new Set(results.map(a => a.id))
        const newAppIds = [...new Set(versions.map(v => v.app_id))]
          .filter(id => !existingIds.has(id))

        if (newAppIds.length) {
          let extraQuery = supabase
            .schema("procurements")
            .from("apps")
            .select(APP_SELECT)
            .in("id", newAppIds)
            .not("status", "in", '("approved","posted")')

          if (fiscalYearId) {
            extraQuery = extraQuery.eq("fiscal_year_id", fiscalYearId)
          }

          const { data: extraApps } = await extraQuery
          if (extraApps?.length) {
            results = [...results, ...(extraApps as AppWithDetails[])]
          }
        }
      }
    }
  }

  return results
}

// ============================================================
// APP mutations
// ============================================================

export async function createApp(
  fiscalYearId: string
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
    .rpc("create_app_for_division", {
      p_division_id: profile.division_id,
      p_fiscal_year_id: fiscalYearId,
    })

  if (error) return { id: null, error: error.message }

  revalidatePath("/dashboard/planning/app")
  return { id: data as string, error: null }
}

// ============================================================
// HOPE review actions
// ============================================================

export async function hopeReviewAppItem(
  appItemId: string,
  input: AppHopeReviewInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("hope_review_app_item", {
      p_app_item_id: appItemId,
      p_action: input.action,
      p_remarks: input.remarks ?? null,
    })

  if (error) return { error: error.message }

  // Notify BAC roles that items have been reviewed
  const appId = await getAppIdFromItemId(supabase, appItemId)
  if (appId) {
    const divisionId = await getAppDivisionId(supabase, appId)
    if (divisionId) {
      const actionLabel = input.action === "approve" ? "approved" : "returned with remarks"
      notifyRoleInDivision(
        ["bac_chair", "bac_vice_chair", "bac_secretariat"],
        divisionId,
        {
          title: "APP Item Reviewed",
          message: `HOPE has ${actionLabel} an APP item.`,
          type: "info",
          reference_type: "app",
          reference_id: appId,
        }
      )
    }
  }

  revalidatePath("/dashboard/planning/app")
  return { error: null }
}

export async function hopeBatchReviewAppItems(
  appItemIds: string[],
  action: 'approve' | 'remark',
  remarks?: string
): Promise<{ count: number | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("hope_batch_review_app_items", {
      p_app_item_ids: appItemIds,
      p_action: action,
      p_remarks: remarks ?? null,
    })

  if (error) return { count: null, error: error.message }

  // Notify BAC roles about batch review
  if (appItemIds.length > 0) {
    const appId = await getAppIdFromItemId(supabase, appItemIds[0])
    if (appId) {
      const divisionId = await getAppDivisionId(supabase, appId)
      if (divisionId) {
        const actionLabel = action === "approve" ? "approved" : "returned with remarks"
        notifyRoleInDivision(
          ["bac_chair", "bac_vice_chair", "bac_secretariat"],
          divisionId,
          {
            title: "APP Items Reviewed",
            message: `HOPE has ${actionLabel} ${appItemIds.length} APP item(s).`,
            type: "info",
            reference_type: "app",
            reference_id: appId,
          }
        )
      }
    }
  }

  revalidatePath("/dashboard/planning/app")
  return { count: data as number, error: null }
}

// ============================================================
// BAC Lot actions
// ============================================================

export async function createAppLot(
  appId: string,
  input: AppLotInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()
  if (await isAppLotsLocked(supabase, appId)) return { id: null, error: "Lot editing is locked — APP is final or approved" }
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("create_app_lot", {
      p_app_id: appId,
      p_lot_name: input.lot_name,
      p_description: input.description ?? null,
      p_procurement_method: input.procurement_method,
    })

  if (error) return { id: null, error: error.message }

  revalidatePath("/dashboard/planning/app")
  return { id: data as string, error: null }
}

export async function assignItemsToLot(
  lotId: string,
  appItemIds: string[]
): Promise<{ count: number | null; error: string | null }> {
  const supabase = await createClient()
  if (await isAppLotsLockedByLot(supabase, lotId)) return { count: null, error: "Lot editing is locked — APP is final or approved" }
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("assign_items_to_lot", {
      p_lot_id: lotId,
      p_app_item_ids: appItemIds,
    })

  if (error) return { count: null, error: error.message }

  revalidatePath("/dashboard/planning/app")
  return { count: data as number, error: null }
}

export async function unassignItemsFromLot(
  appItemIds: string[]
): Promise<{ count: number | null; error: string | null }> {
  const supabase = await createClient()
  if (appItemIds.length > 0 && await isAppLotsLockedByItem(supabase, appItemIds[0])) return { count: null, error: "Lot editing is locked — APP is final or approved" }
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("unassign_items_from_lot", {
      p_app_item_ids: appItemIds,
    })

  if (error) return { count: null, error: error.message }

  revalidatePath("/dashboard/planning/app")
  return { count: data as number, error: null }
}

export async function finalizeLot(
  lotId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  if (await isAppLotsLockedByLot(supabase, lotId)) return { error: "Lot editing is locked — APP is final or approved" }
  const { error } = await supabase
    .schema("procurements")
    .rpc("finalize_lot", { p_lot_id: lotId })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/app")
  return { error: null }
}

export async function updateAppLot(
  lotId: string,
  input: Partial<AppLotInput>
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  if (await isAppLotsLockedByLot(supabase, lotId)) return { error: "Lot editing is locked — APP is final or approved" }
  const { error } = await supabase
    .schema("procurements")
    .from("app_lots")
    .update({
      ...(input.lot_name !== undefined && { lot_name: input.lot_name }),
      ...(input.description !== undefined && { description: input.description || null }),
      ...(input.procurement_method !== undefined && { procurement_method: input.procurement_method }),
    })
    .eq("id", lotId)
    .eq("status", "draft")

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/app")
  return { error: null }
}

export async function deleteAppLot(
  lotId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  if (await isAppLotsLockedByLot(supabase, lotId)) return { error: "Lot editing is locked — APP is final or approved" }
  const { error } = await supabase
    .schema("procurements")
    .rpc("delete_app_lot", { p_lot_id: lotId })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/app")
  return { error: null }
}

// ============================================================
// APP finalization and approval
// ============================================================

export async function finalizeApp(
  appId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("finalize_app", { p_app_id: appId })

  if (error) return { error: error.message }

  // Notify HOPE that the APP is finalized and ready for approval
  const divisionId = await getAppDivisionId(supabase, appId)
  if (divisionId) {
    notifyRoleInDivision(
      ["hope"],
      divisionId,
      {
        title: "APP Finalized",
        message: "The Annual Procurement Plan has been finalized and is ready for your approval.",
        type: "approval",
        reference_type: "app",
        reference_id: appId,
      }
    )
  }

  revalidatePath("/dashboard/planning/app")
  revalidatePath(`/dashboard/planning/app/${appId}`)
  return { error: null }
}

export async function approveApp(
  appId: string,
  notes?: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("approve_app", {
      p_app_id: appId,
      p_notes: notes ?? null,
    })

  if (error) return { error: error.message }

  // Notify supply officers and BAC that the APP has been approved
  const divisionId = await getAppDivisionId(supabase, appId)
  if (divisionId) {
    notifyRoleInDivision(
      ["supply_officer", "bac_chair", "bac_vice_chair", "bac_secretariat"],
      divisionId,
      {
        title: "APP Approved",
        message: "The Annual Procurement Plan has been approved by HOPE. Procurement activities may now proceed.",
        type: "success",
        reference_type: "app",
        reference_id: appId,
      }
    )
  }

  revalidatePath("/dashboard/planning/app")
  revalidatePath(`/dashboard/planning/app/${appId}`)
  return { error: null }
}

// ============================================================
// APP amendment
// ============================================================

export async function createAppAmendment(
  appId: string,
  justification: string,
): Promise<{ versionId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("create_app_amendment", {
      p_app_id: appId,
      p_justification: justification,
    })

  if (error) return { versionId: null, error: error.message }

  revalidatePath("/dashboard/planning/app")
  revalidatePath(`/dashboard/planning/app/${appId}`)
  return { versionId: data as string, error: null }
}

// ============================================================
// Budget adjustment
// ============================================================

export async function adjustAppItemBudget(
  appItemId: string,
  newBudget: string,
  notes?: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("adjust_app_item_budget", {
      p_app_item_id: appItemId,
      p_new_budget: parseFloat(newBudget),
      p_notes: notes ?? null,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/app")
  return { error: null }
}
