"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  AssetWithDetails,
  AssetAssignmentWithDetails,
  DepreciationRecord,
  DeliveryWithItems,
} from "@/types/database"
import type {
  RegisterAssetFromDeliveryInput,
  RegisterAssetManualInput,
  TransferAssetInput,
  UpdateConditionInput,
  InitiateDisposalInput,
  CompleteDisposalInput,
  RunDepreciationInput,
} from "@/lib/schemas/asset"
import {
  notifyUser,
  notifyRoleInDivision,
} from "@/lib/actions/helpers"

// ============================================================
// Select strings
// ============================================================

const ASSET_SELECT = `
  *,
  item_catalog:item_catalog(
    *,
    account_code:account_codes(id, name, code, expense_class)
  ),
  office:offices(id, name, code)
` as const

const ASSIGNMENT_SELECT = `
  *,
  asset:assets(id, property_number, description, asset_type, status),
  office:offices(id, name, code)
` as const

// ============================================================
// Asset Registry queries
// ============================================================

export async function getAssetRegistry(filters?: {
  office_id?: string
  asset_type?: string
  status?: string
  condition_status?: string
}): Promise<AssetWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("assets")
    .select(ASSET_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (filters?.office_id) query = query.eq("office_id", filters.office_id)
  if (filters?.asset_type) query = query.eq("asset_type", filters.asset_type)
  if (filters?.status) query = query.eq("status", filters.status)
  if (filters?.condition_status) query = query.eq("condition_status", filters.condition_status)

  const { data, error } = await query
  if (error) {
    console.error("getAssetRegistry error:", error)
    return []
  }

  const assets = (data ?? []) as AssetWithDetails[]

  // Backfill custodian profiles
  const userIds = new Set<string>()
  assets.forEach(a => {
    if (a.current_custodian_id) userIds.add(a.current_custodian_id)
  })
  if (userIds.size > 0) {
    const { data: profiles } = await supabase
      .schema("procurements")
      .from("user_profiles")
      .select("id, first_name, last_name")
      .in("id", Array.from(userIds))
    const profileMap = new Map(profiles?.map(p => [p.id, p]) ?? [])
    assets.forEach(a => {
      if (a.current_custodian_id) {
        a.current_custodian_profile = profileMap.get(a.current_custodian_id) ?? null
      }
    })
  }

  return assets
}

export async function getAssetById(
  id: string
): Promise<AssetWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("assets")
    .select(ASSET_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) {
    console.error("getAssetById error:", { id, error })
    return null
  }

  const asset = data as AssetWithDetails

  // Backfill custodian profile
  if (asset.current_custodian_id) {
    const { data: profile } = await supabase
      .schema("procurements")
      .from("user_profiles")
      .select("id, first_name, last_name")
      .eq("id", asset.current_custodian_id)
      .single()
    asset.current_custodian_profile = profile ?? null
  }

  return asset
}

// ============================================================
// Asset Assignment queries
// ============================================================

export async function getAssetAssignments(filters?: {
  asset_id?: string
  is_current?: boolean
}): Promise<AssetAssignmentWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("asset_assignments")
    .select(ASSIGNMENT_SELECT)
    .order("assigned_date", { ascending: false })

  if (filters?.asset_id) query = query.eq("asset_id", filters.asset_id)
  if (filters?.is_current !== undefined) query = query.eq("is_current", filters.is_current)

  const { data, error } = await query
  if (error) {
    console.error("getAssetAssignments error:", error)
    return []
  }

  const assignments = (data ?? []) as AssetAssignmentWithDetails[]

  // Backfill custodian and assigned_by profiles
  const userIds = new Set<string>()
  assignments.forEach(a => {
    if (a.custodian_id) userIds.add(a.custodian_id)
    if (a.assigned_by) userIds.add(a.assigned_by)
  })
  if (userIds.size > 0) {
    const { data: profiles } = await supabase
      .schema("procurements")
      .from("user_profiles")
      .select("id, first_name, last_name")
      .in("id", Array.from(userIds))
    const profileMap = new Map(profiles?.map(p => [p.id, p]) ?? [])
    assignments.forEach(a => {
      if (a.custodian_id) a.custodian_profile = profileMap.get(a.custodian_id) ?? null
      if (a.assigned_by) a.assigned_by_profile = profileMap.get(a.assigned_by) ?? null
    })
  }

  return assignments
}

// ============================================================
// Depreciation queries
// ============================================================

export async function getDepreciationSchedule(
  assetId: string
): Promise<DepreciationRecord[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("depreciation_records")
    .select("*")
    .eq("asset_id", assetId)
    .order("period_year", { ascending: true })
    .order("period_month", { ascending: true })

  if (error) {
    console.error("getDepreciationSchedule error:", error)
    return []
  }
  return (data ?? []) as DepreciationRecord[]
}

// ============================================================
// Disposal queries
// ============================================================

export async function getAssetsForDisposal(): Promise<AssetWithDetails[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("assets")
    .select(ASSET_SELECT)
    .eq("status", "for_disposal")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })

  if (error) {
    console.error("getAssetsForDisposal error:", error)
    return []
  }

  const assets = (data ?? []) as AssetWithDetails[]

  // Backfill custodian profiles
  const userIds = new Set<string>()
  assets.forEach(a => {
    if (a.current_custodian_id) userIds.add(a.current_custodian_id)
  })
  if (userIds.size > 0) {
    const { data: profiles } = await supabase
      .schema("procurements")
      .from("user_profiles")
      .select("id, first_name, last_name")
      .in("id", Array.from(userIds))
    const profileMap = new Map(profiles?.map(p => [p.id, p]) ?? [])
    assets.forEach(a => {
      if (a.current_custodian_id) {
        a.current_custodian_profile = profileMap.get(a.current_custodian_id) ?? null
      }
    })
  }

  return assets
}

export async function getDisposedAssets(): Promise<AssetWithDetails[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("assets")
    .select(ASSET_SELECT)
    .eq("status", "disposed")
    .is("deleted_at", null)
    .order("disposal_date", { ascending: false })

  if (error) {
    console.error("getDisposedAssets error:", error)
    return []
  }
  return (data ?? []) as AssetWithDetails[]
}

// ============================================================
// Dashboard / summary queries
// ============================================================

export async function getAssetSummary(): Promise<{
  totalActiveAssets: number
  totalAcquisitionCost: number
  forDisposalCount: number
  pendingRegistrationCount: number
}> {
  const supabase = await createClient()

  const [activeResult, disposalResult, costResult] =
    await Promise.all([
      supabase
        .schema("procurements")
        .from("assets")
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .is("deleted_at", null),
      supabase
        .schema("procurements")
        .from("assets")
        .select("id", { count: "exact", head: true })
        .eq("status", "for_disposal")
        .is("deleted_at", null),
      supabase
        .schema("procurements")
        .from("assets")
        .select("acquisition_cost")
        .eq("status", "active")
        .is("deleted_at", null),
    ])

  const totalAcquisitionCost = (costResult.data ?? []).reduce(
    (sum, a) => sum + parseFloat(a.acquisition_cost || "0"),
    0
  )

  // Count delivery items ready for asset registration
  const pendingCount = (await getDeliveryItemsForRegistration()).length

  return {
    totalActiveAssets: activeResult.count ?? 0,
    totalAcquisitionCost,
    forDisposalCount: disposalResult.count ?? 0,
    pendingRegistrationCount: pendingCount,
  }
}

export async function getDeliveryItemsForRegistration(): Promise<
  Array<{
    delivery_item_id: string
    delivery_number: string
    delivery_id: string
    delivery_date: string
    po_number: string
    description: string
    unit: string
    unit_cost: string
    quantity_accepted: string
    registered_count: number
    remaining: number
    office_id: string | null
    office_name: string | null
    category: string
  }>
> {
  const supabase = await createClient()

  // Get deliveries that passed inspection with semi-expendable/ppe items
  const { data: deliveries, error } = await supabase
    .schema("procurements")
    .from("deliveries")
    .select(`
      id, delivery_number, delivery_date, office_id,
      purchase_order:purchase_orders(
        id, po_number,
        office:offices(id, name, code)
      ),
      delivery_items(
        id, po_item_id, quantity_accepted, office_id,
        po_item:po_items(id, description, unit, unit_cost)
      )
    `)
    .in("inspection_status", ["passed", "partial_acceptance"])
    .is("deleted_at", null)
    .order("delivery_date", { ascending: false })

  if (error) {
    console.error("getDeliveryItemsForRegistration error:", error)
    return []
  }

  if (!deliveries?.length) return []

  // Get all item_catalog entries that are semi_expendable or ppe
  const { data: catalogItems } = await supabase
    .schema("procurements")
    .from("item_catalog")
    .select("id, name, category")
    .in("category", ["semi_expendable", "ppe"])
    .is("deleted_at", null)

  const catalogByName = new Map(
    (catalogItems ?? []).map(c => [c.name, c])
  )

  // Get all registered asset counts per delivery_item
  const allDiIds: string[] = []
  deliveries.forEach(d => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(d as any).delivery_items?.forEach((di: any) => {
      if (di.id) allDiIds.push(di.id)
    })
  })

  let registeredMap = new Map<string, number>()
  if (allDiIds.length > 0) {
    const { data: registeredAssets } = await supabase
      .schema("procurements")
      .from("assets")
      .select("source_delivery_item_id")
      .in("source_delivery_item_id", allDiIds)
      .is("deleted_at", null)

    const counts = new Map<string, number>()
    ;(registeredAssets ?? []).forEach(a => {
      if (a.source_delivery_item_id) {
        counts.set(a.source_delivery_item_id, (counts.get(a.source_delivery_item_id) ?? 0) + 1)
      }
    })
    registeredMap = counts
  }

  // Build result: only items where catalog category is semi_expendable/ppe
  // and there are remaining items to register
  const result: Array<{
    delivery_item_id: string
    delivery_number: string
    delivery_id: string
    delivery_date: string
    po_number: string
    description: string
    unit: string
    unit_cost: string
    quantity_accepted: string
    registered_count: number
    remaining: number
    office_id: string | null
    office_name: string | null
    category: string
  }> = []

  for (const d of deliveries) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const po = (d as any).purchase_order
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = ((d as any).delivery_items ?? []) as any[]

    for (const di of items) {
      const accepted = Math.floor(parseFloat(di.quantity_accepted || "0"))
      if (accepted <= 0) continue

      const poItem = di.po_item
      if (!poItem) continue

      // Check if this item is in the catalog as semi_expendable/ppe
      const catalog = catalogByName.get(poItem.description)
      if (!catalog || !["semi_expendable", "ppe"].includes(catalog.category)) continue

      const registered = registeredMap.get(di.id) ?? 0
      const remaining = accepted - registered
      if (remaining <= 0) continue

      result.push({
        delivery_item_id: di.id,
        delivery_number: d.delivery_number,
        delivery_id: d.id,
        delivery_date: d.delivery_date,
        po_number: po?.po_number ?? "—",
        description: poItem.description,
        unit: poItem.unit,
        unit_cost: poItem.unit_cost,
        quantity_accepted: di.quantity_accepted,
        registered_count: registered,
        remaining,
        office_id: di.office_id ?? d.office_id,
        office_name: po?.office?.name ?? null,
        category: catalog.category,
      })
    }
  }

  return result
}

// ============================================================
// Division users query (for custodian picker)
// ============================================================

export async function getDivisionUsers(): Promise<
  Array<{ id: string; first_name: string; last_name: string; office_name: string | null }>
> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("id, first_name, last_name, office:offices(name)")
    .eq("status", "active")
    .order("last_name", { ascending: true })

  if (error) {
    console.error("getDivisionUsers error:", error)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((u: any) => ({
    id: u.id,
    first_name: u.first_name,
    last_name: u.last_name,
    office_name: u.office?.name ?? null,
  }))
}

// ============================================================
// Register Asset from Delivery
// ============================================================

export async function registerAssetFromDelivery(
  input: RegisterAssetFromDeliveryInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()

  const details: Record<string, unknown> = {}
  if (input.brand_model) details.brand_model = input.brand_model
  if (input.serial_number) details.serial_number = input.serial_number
  if (input.location) details.location = input.location
  if (input.custodian_id) details.custodian_id = input.custodian_id
  if (input.residual_value != null) details.residual_value = input.residual_value
  if (input.useful_life_years != null) details.useful_life_years = input.useful_life_years
  if (input.acquisition_date) details.acquisition_date = input.acquisition_date

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("register_asset_from_delivery", {
      p_delivery_item_id: input.delivery_item_id,
      p_details: details,
    })

  if (error) {
    console.error("registerAssetFromDelivery error:", error)
    return { error: error.message }
  }

  // Notify custodian if assigned
  if (input.custodian_id) {
    await notifyUser(input.custodian_id, {
      title: "Asset Assigned to You",
      message: "A new asset has been registered and assigned to your custody.",
      type: "info",
      reference_type: "asset",
      reference_id: data as string,
    })
  }

  revalidatePath("/dashboard/assets")
  return { error: null, id: data as string }
}

// ============================================================
// Register Asset Manual
// ============================================================

export async function registerAssetManual(
  input: RegisterAssetManualInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()

  const details: Record<string, unknown> = {
    item_catalog_id: input.item_catalog_id,
    office_id: input.office_id,
    description: input.description,
    acquisition_date: input.acquisition_date,
    acquisition_cost: input.acquisition_cost,
    asset_type: input.asset_type,
  }
  if (input.brand_model) details.brand_model = input.brand_model
  if (input.serial_number) details.serial_number = input.serial_number
  if (input.location) details.location = input.location
  if (input.custodian_id) details.custodian_id = input.custodian_id
  if (input.useful_life_years != null) details.useful_life_years = input.useful_life_years
  if (input.residual_value != null) details.residual_value = input.residual_value

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("register_asset_manual", {
      p_details: details,
    })

  if (error) {
    console.error("registerAssetManual error:", error)
    return { error: error.message }
  }

  if (input.custodian_id) {
    await notifyUser(input.custodian_id, {
      title: "Asset Assigned to You",
      message: `Asset "${input.description}" has been registered and assigned to your custody.`,
      type: "info",
      reference_type: "asset",
      reference_id: data as string,
    })
  }

  revalidatePath("/dashboard/assets")
  return { error: null, id: data as string }
}

// ============================================================
// Transfer Asset
// ============================================================

export async function transferAsset(
  input: TransferAssetInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("transfer_asset", {
      p_asset_id: input.asset_id,
      p_new_custodian_id: input.new_custodian_id,
      p_new_office_id: input.new_office_id ?? null,
      p_remarks: input.remarks ?? null,
    })

  if (error) {
    console.error("transferAsset error:", error)
    return { error: error.message }
  }

  // Get asset details for notification
  const { data: asset } = await supabase
    .schema("procurements")
    .from("assets")
    .select("property_number, description, current_custodian_id")
    .eq("id", input.asset_id)
    .single()

  // Notify new custodian
  await notifyUser(input.new_custodian_id, {
    title: "Asset Transferred to You",
    message: `Asset ${asset?.property_number ?? ""} (${asset?.description ?? "N/A"}) has been transferred to your custody.`,
    type: "info",
    reference_type: "asset",
    reference_id: input.asset_id,
  })

  revalidatePath("/dashboard/assets")
  return { error: null, id: data as string }
}

// ============================================================
// Update Asset Condition
// ============================================================

export async function updateAssetCondition(
  assetId: string,
  input: UpdateConditionInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .from("assets")
    .update({ condition_status: input.condition_status })
    .eq("id", assetId)

  if (error) {
    console.error("updateAssetCondition error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/assets")
  return { error: null }
}

// ============================================================
// Disposal
// ============================================================

export async function initiateDisposal(
  assetId: string,
  input: InitiateDisposalInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("initiate_disposal", {
      p_asset_id: assetId,
      p_method: input.method,
      p_remarks: input.remarks ?? null,
    })

  if (error) {
    console.error("initiateDisposal error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/assets")
  return { error: null }
}

export async function completeDisposal(
  assetId: string,
  input: CompleteDisposalInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("complete_disposal", {
      p_asset_id: assetId,
      p_disposal_reference: input.disposal_reference,
    })

  if (error) {
    console.error("completeDisposal error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/assets")
  return { error: null }
}

// ============================================================
// Revert Disposal
// ============================================================

export async function revertDisposal(
  assetId: string,
  remarks?: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("revert_disposal", {
      p_asset_id: assetId,
      p_remarks: remarks ?? null,
    })

  if (error) {
    console.error("revertDisposal error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/assets")
  return { error: null }
}

// ============================================================
// Depreciation
// ============================================================

export async function calculateSingleDepreciation(
  assetId: string
): Promise<{ error: string | null; amount?: number }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("calculate_depreciation", {
      p_asset_id: assetId,
    })

  if (error) {
    console.error("calculateSingleDepreciation error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/assets")
  return { error: null, amount: data as number }
}

export async function runMonthlyDepreciation(
  input: RunDepreciationInput
): Promise<{ error: string | null; count?: number }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .single()

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("run_monthly_depreciation", {
      p_year: input.year,
      p_month: input.month,
    })

  if (error) {
    console.error("runMonthlyDepreciation error:", error)
    return { error: error.message }
  }

  // Notify division about batch depreciation
  if (profile?.division_id && (data as number) > 0) {
    await notifyRoleInDivision(
      ["supply_officer", "accountant"],
      profile.division_id,
      {
        title: "Monthly Depreciation Completed",
        message: `Depreciation for ${input.month}/${input.year} has been processed for ${data} asset(s).`,
        type: "success",
        reference_type: "depreciation",
        reference_id: profile.division_id,
      }
    )
  }

  revalidatePath("/dashboard/assets")
  return { error: null, count: data as number }
}
