"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  PurchaseOrderWithDetails,
  DeliveryWithItems,
} from "@/types/database"
import type {
  CreatePoInput,
  ApprovePoInput,
  RecordDeliveryInput,
  CompleteInspectionInput,
} from "@/lib/schemas/procurement"
import {
  getUserRoleContext,
  notifyRoleInDivision,
  notifyRoleInOffice,
} from "@/lib/actions/helpers"

// ============================================================
// Select strings
// ============================================================

const PO_SELECT = `
  *,
  procurement:procurement_activities(id, procurement_number, procurement_method, abc_amount, contract_amount),
  supplier:suppliers(id, name, trade_name, tin),
  office:offices(id, name, code),
  fiscal_year:fiscal_years(id, year, status)
` as const

const PO_DETAIL_SELECT = `
  *,
  procurement:procurement_activities(id, procurement_number, procurement_method, abc_amount, contract_amount, purchase_request_id),
  supplier:suppliers(id, name, trade_name, tin),
  office:offices(id, name, code),
  fiscal_year:fiscal_years(id, year, status),
  po_items(
    *,
    pr_item:pr_items(id, description, unit, quantity, estimated_unit_cost)
  ),
  deliveries(
    *,
    delivery_items(
      *,
      po_item:po_items(id, description, unit, quantity, unit_cost)
    )
  )
` as const

const DELIVERY_SELECT = `
  *,
  delivery_items(
    *,
    po_item:po_items(id, description, unit, quantity, unit_cost)
  ),
  purchase_order:purchase_orders(
    id, po_number, status, total_amount, delivery_date, delivery_address, payment_terms, approved_at, issued_at, created_at,
    supplier:suppliers(id, name, trade_name, tin),
    office:offices(id, name, code),
    po_items(id, description, unit, quantity, unit_cost, total_cost, delivered_quantity, accepted_quantity)
  )
` as const

// ============================================================
// PO queries
// ============================================================

export async function getPurchaseOrders(
  fiscalYearId?: string
): Promise<PurchaseOrderWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("purchase_orders")
    .select(PO_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId)

  const { data, error } = await query
  if (error) {
    console.error("getPurchaseOrders error:", error)
    return []
  }
  return (data ?? []) as PurchaseOrderWithDetails[]
}

export async function getPurchaseOrderById(
  id: string
): Promise<PurchaseOrderWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("purchase_orders")
    .select(PO_DETAIL_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) {
    console.error("getPurchaseOrderById error:", { id, error })
    return null
  }

  const po = data as PurchaseOrderWithDetails

  // Backfill delivery profile data (received_by, inspected_by FK auth.users,
  // not user_profiles, so PostgREST cannot embed them)
  if (po.deliveries?.length) {
    const userIds = new Set<string>()
    po.deliveries.forEach(d => {
      if (d.received_by) userIds.add(d.received_by)
      if (d.inspected_by) userIds.add(d.inspected_by)
    })
    if (userIds.size > 0) {
      const { data: profiles } = await supabase
        .schema("procurements")
        .from("user_profiles")
        .select("id, first_name, last_name")
        .in("id", Array.from(userIds))
      const profileMap = new Map(profiles?.map(p => [p.id, p]) ?? [])
      po.deliveries.forEach(d => {
        if (d.received_by) d.received_by_profile = profileMap.get(d.received_by) ?? null
        if (d.inspected_by) d.inspected_by_profile = profileMap.get(d.inspected_by) ?? null
      })
    }
  }

  return po
}

export async function getPosRequiringMyAction(): Promise<PurchaseOrderWithDetails[]> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)
  if (!ctx) return []

  const { roleNames } = ctx

  const isCreator = roleNames.some(r =>
    ["supply_officer", "bac_secretariat", "division_admin"].includes(r)
  )
  const isApprover = roleNames.some(r =>
    ["hope", "division_chief", "division_admin"].includes(r)
  )
  const isInspector = roleNames.some(r =>
    ["iac_member", "supply_officer", "division_admin"].includes(r)
  )

  if (!isCreator && !isApprover && !isInspector) return []

  const statuses: string[] = []
  if (isApprover) statuses.push("draft")
  if (isCreator) statuses.push("approved")
  if (isInspector || isCreator) statuses.push("issued", "partially_delivered")

  const { data, error } = await supabase
    .schema("procurements")
    .from("purchase_orders")
    .select(PO_SELECT)
    .in("status", statuses)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getPosRequiringMyAction error:", error)
    return []
  }
  return (data ?? []) as PurchaseOrderWithDetails[]
}

export async function getPoForProcurement(
  procurementId: string
): Promise<PurchaseOrderWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("purchase_orders")
    .select(PO_SELECT)
    .eq("procurement_id", procurementId)
    .neq("status", "cancelled")
    .is("deleted_at", null)
    .maybeSingle()

  if (error) {
    console.error("getPoForProcurement error:", error)
    return null
  }
  return data as PurchaseOrderWithDetails | null
}

// ============================================================
// Delivery queries
// ============================================================

export async function getDeliveries(
  poId?: string
): Promise<DeliveryWithItems[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("deliveries")
    .select(DELIVERY_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (poId) query = query.eq("purchase_order_id", poId)

  const { data, error } = await query
  if (error) {
    console.error("getDeliveries error:", error)
    return []
  }
  return (data ?? []) as DeliveryWithItems[]
}

export async function getDeliveryById(
  id: string
): Promise<DeliveryWithItems | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("deliveries")
    .select(DELIVERY_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) {
    console.error("getDeliveryById error:", { id, error })
    return null
  }

  const delivery = data as DeliveryWithItems

  // Backfill profile data
  const userIds: string[] = []
  if (delivery.received_by) userIds.push(delivery.received_by)
  if (delivery.inspected_by) userIds.push(delivery.inspected_by)
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .schema("procurements")
      .from("user_profiles")
      .select("id, first_name, last_name")
      .in("id", userIds)
    const profileMap = new Map(profiles?.map(p => [p.id, p]) ?? [])
    if (delivery.received_by) delivery.received_by_profile = profileMap.get(delivery.received_by) ?? null
    if (delivery.inspected_by) delivery.inspected_by_profile = profileMap.get(delivery.inspected_by) ?? null
  }

  return delivery
}

export async function getDeliveriesRequiringInspection(): Promise<DeliveryWithItems[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("deliveries")
    .select(DELIVERY_SELECT)
    .eq("inspection_status", "pending")
    .is("deleted_at", null)
    .order("delivery_date", { ascending: true })

  if (error) {
    console.error("getDeliveriesRequiringInspection error:", error)
    return []
  }
  return (data ?? []) as DeliveryWithItems[]
}

// ============================================================
// PO mutations
// ============================================================

export async function createPurchaseOrder(
  input: CreatePoInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("create_purchase_order", {
      p_procurement_id: input.procurement_id,
    })

  if (error) {
    console.error("createPurchaseOrder error:", error)
    return { error: error.message }
  }

  const poId = data as string

  // Fetch PO details for notification context
  const { data: po } = await supabase
    .schema("procurements")
    .from("purchase_orders")
    .select("po_number, division_id, office_id")
    .eq("id", poId)
    .single()

  if (po) {
    await notifyRoleInDivision(
      ["hope", "division_chief"],
      po.division_id,
      {
        title: "Purchase Order Awaiting Approval",
        message: `${po.po_number} has been created and requires your approval`,
        type: "approval",
        reference_type: "purchase_order",
        reference_id: poId,
      }
    )
  }

  revalidatePath("/dashboard/procurement")
  return { error: null, id: poId }
}

export async function approvePurchaseOrder(
  poId: string,
  input: ApprovePoInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("approve_purchase_order", {
      p_po_id: poId,
      p_remarks: input.remarks ?? null,
    })

  if (error) {
    console.error("approvePurchaseOrder error:", error)
    return { error: error.message }
  }

  // Notify supply officer that PO is approved
  const { data: po } = await supabase
    .schema("procurements")
    .from("purchase_orders")
    .select("po_number, division_id, office_id")
    .eq("id", poId)
    .single()

  if (po) {
    await notifyRoleInOffice(
      ["supply_officer", "bac_secretariat"],
      po.office_id,
      {
        title: "Purchase Order Approved",
        message: `${po.po_number} has been approved and is ready to be issued`,
        type: "success",
        reference_type: "purchase_order",
        reference_id: poId,
      }
    )
  }

  revalidatePath("/dashboard/procurement")
  return { error: null }
}

export async function issuePurchaseOrder(
  poId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("issue_purchase_order", { p_po_id: poId })

  if (error) {
    console.error("issuePurchaseOrder error:", error)
    return { error: error.message }
  }

  const { data: po } = await supabase
    .schema("procurements")
    .from("purchase_orders")
    .select("po_number, division_id, office_id")
    .eq("id", poId)
    .single()

  if (po) {
    await notifyRoleInOffice(
      ["supply_officer", "bac_secretariat"],
      po.office_id,
      {
        title: "Purchase Order Issued",
        message: `${po.po_number} has been issued to the supplier`,
        type: "info",
        reference_type: "purchase_order",
        reference_id: poId,
      }
    )
  }

  revalidatePath("/dashboard/procurement")
  return { error: null }
}

export async function cancelPurchaseOrder(
  poId: string,
  reason: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("cancel_purchase_order", {
      p_po_id: poId,
      p_reason: reason,
    })

  if (error) {
    console.error("cancelPurchaseOrder error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/procurement")
  return { error: null }
}

// ============================================================
// Delivery mutations
// ============================================================

export async function recordDelivery(
  input: RecordDeliveryInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()

  const itemsJsonb = input.items.map(item => ({
    po_item_id: item.po_item_id,
    quantity_delivered: item.quantity_delivered,
  }))

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("record_delivery", {
      p_po_id: input.purchase_order_id,
      p_items: itemsJsonb,
      p_delivery_date: input.delivery_date,
      p_remarks: input.remarks ?? null,
    })

  if (error) {
    console.error("recordDelivery error:", error)
    return { error: error.message }
  }

  const deliveryId = data as string

  // Notify IAC for inspection
  const { data: po } = await supabase
    .schema("procurements")
    .from("purchase_orders")
    .select("po_number, division_id, office_id")
    .eq("id", input.purchase_order_id)
    .single()

  if (po) {
    await notifyRoleInOffice(
      ["iac_member"],
      po.office_id,
      {
        title: "Delivery Awaiting Inspection",
        message: `A delivery for ${po.po_number} has been received and requires inspection`,
        type: "approval",
        reference_type: "delivery",
        reference_id: deliveryId,
      }
    )
  }

  revalidatePath("/dashboard/procurement")
  return { error: null, id: deliveryId }
}

export async function completeInspection(
  input: CompleteInspectionInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const resultsJsonb = input.results.map(r => ({
    delivery_item_id: r.delivery_item_id,
    quantity_accepted: r.quantity_accepted,
    quantity_rejected: r.quantity_rejected,
    rejection_reason: r.rejection_reason ?? null,
  }))

  const { error } = await supabase
    .schema("procurements")
    .rpc("complete_inspection", {
      p_delivery_id: input.delivery_id,
      p_results: resultsJsonb,
      p_report_number: input.inspection_report_number ?? null,
    })

  if (error) {
    console.error("completeInspection error:", error)
    return { error: error.message }
  }

  // Notify supply officer
  const { data: delivery } = await supabase
    .schema("procurements")
    .from("deliveries")
    .select("delivery_number, office_id, purchase_order_id")
    .eq("id", input.delivery_id)
    .single()

  if (delivery) {
    await notifyRoleInOffice(
      ["supply_officer", "bac_secretariat"],
      delivery.office_id,
      {
        title: "Delivery Inspection Completed",
        message: `Inspection for delivery ${delivery.delivery_number} has been completed`,
        type: "success",
        reference_type: "delivery",
        reference_id: input.delivery_id,
      }
    )
  }

  revalidatePath("/dashboard/procurement")
  return { error: null }
}
