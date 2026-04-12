"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  ItemCatalogWithDetails,
  InventoryWithDetails,
  StockMovementWithDetails,
  DeliveryWithItems,
} from "@/types/database"
import type {
  ItemCatalogInput,
  InventorySettingsInput,
  ManualStockInInput,
  StockOutInput,
  PhysicalCountInput,
} from "@/lib/schemas/inventory"
import {
  notifyRoleInOffice,
} from "@/lib/actions/helpers"

// ============================================================
// Select strings
// ============================================================

const ITEM_CATALOG_SELECT = `
  *,
  account_code:account_codes(id, name, code, expense_class)
` as const

const INVENTORY_SELECT = `
  *,
  item_catalog:item_catalog(
    *,
    account_code:account_codes(id, name, code, expense_class)
  ),
  office:offices(id, name, code)
` as const

const STOCK_MOVEMENT_SELECT = `
  *,
  inventory:inventory(
    id, item_catalog_id, office_id,
    item_catalog:item_catalog(id, code, name, unit)
  )
` as const

// ============================================================
// Item Catalog queries
// ============================================================

export async function getItemCatalog(
  category?: string
): Promise<ItemCatalogWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("item_catalog")
    .select(ITEM_CATALOG_SELECT)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (category) query = query.eq("category", category)

  const { data, error } = await query
  if (error) {
    console.error("getItemCatalog error:", error)
    return []
  }
  return (data ?? []) as ItemCatalogWithDetails[]
}

export async function getItemCatalogById(
  id: string
): Promise<ItemCatalogWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("item_catalog")
    .select(ITEM_CATALOG_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) {
    console.error("getItemCatalogById error:", { id, error })
    return null
  }
  return data as ItemCatalogWithDetails
}

// ============================================================
// Inventory queries
// ============================================================

export async function getInventoryList(
  officeId?: string
): Promise<InventoryWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("inventory")
    .select(INVENTORY_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (officeId) query = query.eq("office_id", officeId)

  const { data, error } = await query
  if (error) {
    console.error("getInventoryList error:", error)
    return []
  }
  return (data ?? []) as InventoryWithDetails[]
}

export async function getInventoryById(
  id: string
): Promise<InventoryWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("inventory")
    .select(INVENTORY_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) {
    console.error("getInventoryById error:", { id, error })
    return null
  }
  return data as InventoryWithDetails
}

// ============================================================
// Stock Movement queries
// ============================================================

export async function getStockMovements(
  inventoryId: string
): Promise<StockMovementWithDetails[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("stock_movements")
    .select(STOCK_MOVEMENT_SELECT)
    .eq("inventory_id", inventoryId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getStockMovements error:", error)
    return []
  }

  const movements = (data ?? []) as StockMovementWithDetails[]

  // Backfill created_by profiles
  const userIds = new Set<string>()
  movements.forEach(m => {
    if (m.created_by) userIds.add(m.created_by)
  })
  if (userIds.size > 0) {
    const { data: profiles } = await supabase
      .schema("procurements")
      .from("user_profiles")
      .select("id, first_name, last_name")
      .in("id", Array.from(userIds))
    const profileMap = new Map(profiles?.map(p => [p.id, p]) ?? [])
    movements.forEach(m => {
      if (m.created_by) m.created_by_profile = profileMap.get(m.created_by) ?? null
    })
  }

  return movements
}

// ============================================================
// Dashboard / summary queries
// ============================================================

export async function getReorderAlerts(): Promise<InventoryWithDetails[]> {
  const supabase = await createClient()
  // PostgREST doesn't support column-to-column comparison,
  // so fetch all with reorder_point > 0 and filter in JS
  const { data, error } = await supabase
    .schema("procurements")
    .from("inventory")
    .select(INVENTORY_SELECT)
    .is("deleted_at", null)
    .gt("reorder_point", 0)
    .order("current_quantity", { ascending: true })

  if (error) {
    console.error("getReorderAlerts error:", error)
    return []
  }

  return ((data ?? []) as InventoryWithDetails[]).filter(
    (inv) => parseFloat(inv.current_quantity) <= parseFloat(inv.reorder_point)
  )
}

export async function getInventorySummary(): Promise<{
  totalCatalogItems: number
  totalInventoryRecords: number
  lowStockCount: number
  deliveriesReadyCount: number
}> {
  const supabase = await createClient()

  const [catalogResult, inventoryResult, reorderAlerts, deliveriesResult] =
    await Promise.all([
      supabase
        .schema("procurements")
        .from("item_catalog")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("is_active", true),
      supabase
        .schema("procurements")
        .from("inventory")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null),
      getReorderAlerts(),
      getDeliveriesReadyForStockIn(),
    ])

  return {
    totalCatalogItems: catalogResult.count ?? 0,
    totalInventoryRecords: inventoryResult.count ?? 0,
    lowStockCount: reorderAlerts.length,
    deliveriesReadyCount: deliveriesResult.length,
  }
}

export async function getDeliveriesReadyForStockIn(): Promise<DeliveryWithItems[]> {
  const supabase = await createClient()

  // Get deliveries that passed inspection
  const { data: deliveries, error } = await supabase
    .schema("procurements")
    .from("deliveries")
    .select(`
      *,
      delivery_items(
        *,
        po_item:po_items(id, description, unit, quantity, unit_cost)
      ),
      purchase_order:purchase_orders(
        id, po_number, status,
        supplier:suppliers(id, name, trade_name),
        office:offices(id, name, code)
      )
    `)
    .in("inspection_status", ["passed", "partial_acceptance"])
    .is("deleted_at", null)
    .order("inspection_date", { ascending: false })

  if (error) {
    console.error("getDeliveriesReadyForStockIn error:", error)
    return []
  }

  if (!deliveries?.length) return []

  // Filter out deliveries that have already been stocked in
  const deliveryIds = deliveries.map(d => d.id)
  const { data: stockedMovements } = await supabase
    .schema("procurements")
    .from("stock_movements")
    .select("reference_id")
    .eq("reference_type", "delivery")
    .in("reference_id", deliveryIds)

  const stockedIds = new Set(stockedMovements?.map(m => m.reference_id) ?? [])
  const ready = deliveries.filter(d => !stockedIds.has(d.id))

  return ready as DeliveryWithItems[]
}

// ============================================================
// Item Catalog mutations
// ============================================================

export async function createItemCatalogEntry(
  input: ItemCatalogInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .single()

  if (!profile) return { error: "User profile not found" }

  const { data, error } = await supabase
    .schema("procurements")
    .from("item_catalog")
    .insert({
      division_id: profile.division_id,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      unit: input.unit,
      account_code_id: input.account_code_id ?? null,
      useful_life_years: input.useful_life_years ?? null,
      is_active: input.is_active,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) {
    console.error("createItemCatalogEntry error:", error)
    if (error.code === "23505") return { error: "An item with this code already exists" }
    return { error: error.message }
  }

  revalidatePath("/dashboard/admin/item-catalog")
  revalidatePath("/dashboard/assets")
  return { error: null, id: data.id }
}

export async function updateItemCatalogEntry(
  id: string,
  input: ItemCatalogInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .from("item_catalog")
    .update({
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      unit: input.unit,
      account_code_id: input.account_code_id ?? null,
      useful_life_years: input.useful_life_years ?? null,
      is_active: input.is_active,
    })
    .eq("id", id)

  if (error) {
    console.error("updateItemCatalogEntry error:", error)
    if (error.code === "23505") return { error: "An item with this code already exists" }
    return { error: error.message }
  }

  revalidatePath("/dashboard/admin/item-catalog")
  revalidatePath("/dashboard/assets")
  return { error: null }
}

export async function deleteItemCatalogEntry(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .from("item_catalog")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)

  if (error) {
    console.error("deleteItemCatalogEntry error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/admin/item-catalog")
  revalidatePath("/dashboard/assets")
  return { error: null }
}

// ============================================================
// Inventory settings mutation
// ============================================================

export async function updateInventorySettings(
  id: string,
  input: InventorySettingsInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .from("inventory")
    .update({
      reorder_point: input.reorder_point,
      location: input.location ?? null,
    })
    .eq("id", id)

  if (error) {
    console.error("updateInventorySettings error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/assets")
  return { error: null }
}

// ============================================================
// Stock In from Delivery
// ============================================================

export async function stockInFromDelivery(
  deliveryId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("stock_in_from_delivery", {
      p_delivery_id: deliveryId,
    })

  if (error) {
    console.error("stockInFromDelivery error:", error)
    return { error: error.message }
  }

  // Notify supply officers
  const { data: delivery } = await supabase
    .schema("procurements")
    .from("deliveries")
    .select("delivery_number, office_id")
    .eq("id", deliveryId)
    .single()

  if (delivery?.office_id) {
    await notifyRoleInOffice(
      ["supply_officer"],
      delivery.office_id,
      {
        title: "Stock In Completed",
        message: `Delivery ${delivery.delivery_number} has been stocked in to inventory`,
        type: "success",
        reference_type: "delivery",
        reference_id: deliveryId,
      }
    )
  }

  revalidatePath("/dashboard/assets")
  revalidatePath("/dashboard/procurement")
  return { error: null }
}

// ============================================================
// Manual Stock In
// ============================================================

export async function manualStockIn(
  input: ManualStockInInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("manual_stock_in", {
      p_item_catalog_id: input.item_catalog_id,
      p_office_id: input.office_id,
      p_quantity: input.quantity,
      p_remarks: input.remarks ?? null,
    })

  if (error) {
    console.error("manualStockIn error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/assets")
  return { error: null, id: data as string }
}

// ============================================================
// Stock Out for Issuance
// ============================================================

export async function stockOutForIssuance(
  input: StockOutInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("stock_out_for_issuance", {
      p_inventory_id: input.inventory_id,
      p_quantity: input.quantity,
      p_reference_type: input.reference_type,
      p_reference_id: input.reference_id ?? null,
      p_remarks: input.remarks ?? null,
    })

  if (error) {
    console.error("stockOutForIssuance error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/assets")
  return { error: null, id: data as string }
}

// ============================================================
// Physical Count
// ============================================================

export async function recordPhysicalCount(
  input: PhysicalCountInput
): Promise<{ error: string | null; variance?: number }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("record_physical_count", {
      p_inventory_id: input.inventory_id,
      p_counted_quantity: input.counted_quantity,
      p_remarks: input.remarks ?? null,
    })

  if (error) {
    console.error("recordPhysicalCount error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/assets")
  return { error: null, variance: data as number }
}
