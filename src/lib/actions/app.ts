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
      lot:app_lots!fk_app_items_lot_id(id, lot_name, lot_number)
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
  canManageLots: boolean
  canFinalizeLot: boolean
  canFinalizeApp: boolean
  canApproveApp: boolean
}> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)
  if (!ctx) return { canHopeReview: false, canManageLots: false, canFinalizeLot: false, canFinalizeApp: false, canApproveApp: false }

  const { roleNames } = ctx
  const isHope = roleNames.includes("hope") || roleNames.includes("division_admin")
  const isBac = roleNames.some(r => ["bac_chair", "bac_member", "bac_secretariat", "division_admin"].includes(r))
  const canFinalizeLot = roleNames.some(r => ["bac_chair", "bac_secretariat", "division_admin"].includes(r))

  return {
    canHopeReview: isHope,
    canManageLots: isBac,
    canFinalizeLot,
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
    ["bac_chair", "bac_member", "bac_secretariat"].includes(r)
  )

  if (!isHope && !isBac) return []

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
  return (data ?? []) as AppWithDetails[]
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
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("create_app_lot", {
      p_app_id: appId,
      p_lot_name: input.lot_name,
      p_description: input.description ?? null,
      p_procurement_method: input.procurement_method ?? null,
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
  const { error } = await supabase
    .schema("procurements")
    .rpc("finalize_lot", { p_lot_id: lotId })

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

  revalidatePath("/dashboard/planning/app")
  revalidatePath(`/dashboard/planning/app/${appId}`)
  return { error: null }
}
