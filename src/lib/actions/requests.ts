"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  RequestWithDetails,
} from "@/types/database"
import type {
  CreateRequestInput,
  ApproveRequestInput,
  RejectRequestInput,
  FulfillRequestInput,
  RouteToProcurementInput,
  CompleteServiceInput,
} from "@/lib/schemas/request"
import {
  notifyRoleInOffice,
  notifyUser,
} from "@/lib/actions/helpers"

// ============================================================
// Select strings
// ============================================================

const REQUEST_SELECT = `
  *,
  office:offices(id, name, code),
  requested_by_profile:user_profiles!requested_by(id, first_name, last_name, position),
  supervisor_profile:user_profiles!supervisor_id(id, first_name, last_name),
  processed_by_profile:user_profiles!processed_by(id, first_name, last_name),
  linked_pr:purchase_requests!linked_pr_id(id, pr_number, status),
  request_items(
    *,
    item_catalog:item_catalog(id, code, name, unit, category),
    inventory:inventory(id, current_quantity, office_id)
  )
` as const

// ============================================================
// Query functions
// ============================================================

export async function getMyRequests(): Promise<RequestWithDetails[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .schema("procurements")
    .from("requests")
    .select(REQUEST_SELECT)
    .eq("requested_by", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getMyRequests error:", error)
    return []
  }
  return (data ?? []) as unknown as RequestWithDetails[]
}

export async function getOfficeRequests(officeId?: string): Promise<RequestWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("requests")
    .select(REQUEST_SELECT)
    .is("deleted_at", null)
    .neq("status", "draft")
    .order("created_at", { ascending: false })

  if (officeId) {
    query = query.eq("office_id", officeId)
  }

  const { data, error } = await query
  if (error) {
    console.error("getOfficeRequests error:", error)
    return []
  }
  return (data ?? []) as unknown as RequestWithDetails[]
}

export async function getAllRequests(): Promise<RequestWithDetails[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .from("requests")
    .select(REQUEST_SELECT)
    .is("deleted_at", null)
    .neq("status", "draft")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getAllRequests error:", error)
    return []
  }
  return (data ?? []) as unknown as RequestWithDetails[]
}

export async function getRequestById(id: string): Promise<RequestWithDetails | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .from("requests")
    .select(REQUEST_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) {
    console.error("getRequestById error:", { id, error })
    return null
  }
  return data as unknown as RequestWithDetails
}

export async function getPendingApprovals(): Promise<RequestWithDetails[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .from("requests")
    .select(REQUEST_SELECT)
    .eq("status", "submitted")
    .is("deleted_at", null)
    .order("urgency", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) {
    console.error("getPendingApprovals error:", error)
    return []
  }
  return (data ?? []) as unknown as RequestWithDetails[]
}

export async function getRequestsForProcessing(): Promise<RequestWithDetails[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .from("requests")
    .select(REQUEST_SELECT)
    .in("status", ["supervisor_approved", "processing", "partially_fulfilled"])
    .is("deleted_at", null)
    .order("urgency", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) {
    console.error("getRequestsForProcessing error:", error)
    return []
  }
  return (data ?? []) as unknown as RequestWithDetails[]
}

// ============================================================
// Inventory stock lookup for fulfillment UI
// ============================================================

export async function getStockForCatalogItem(
  itemCatalogId: string
): Promise<{ id: string; office_id: string; office_name: string; current_quantity: string }[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .from("inventory")
    .select("id, office_id, current_quantity, office:offices(id, name)")
    .eq("item_catalog_id", itemCatalogId)
    .is("deleted_at", null)
    .gt("current_quantity", 0)

  if (error) {
    console.error("getStockForCatalogItem error:", error)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((inv: any) => ({
    id: inv.id,
    office_id: inv.office_id,
    office_name: inv.office?.name ?? "Unknown",
    current_quantity: inv.current_quantity,
  }))
}

// ============================================================
// Mutation functions
// ============================================================

export async function createRequest(
  input: CreateRequestInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("create_request", {
      p_request_type: input.request_type,
      p_office_id:    input.office_id,
      p_purpose:      input.purpose,
      p_urgency:      input.urgency,
      p_items:        input.items.map((item, idx) => ({
        item_catalog_id:    item.item_catalog_id ?? null,
        description:        item.description,
        unit:               item.unit,
        quantity_requested: item.quantity_requested,
        remarks:            item.remarks ?? null,
        item_number:        idx + 1,
      })),
    })

  if (error) {
    console.error("createRequest error:", error)
    return { id: null, error: error.message }
  }

  revalidatePath("/dashboard/requests")
  return { id: data as string, error: null }
}

export async function submitRequest(
  requestId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("submit_request", { p_request_id: requestId })

  if (error) {
    console.error("submitRequest error:", { requestId, error })
    return { error: error.message }
  }

  // Fetch request for notification context
  const { data: req } = await supabase
    .schema("procurements")
    .from("requests")
    .select("request_number, office_id, supervisor_id")
    .eq("id", requestId)
    .single()

  if (req) {
    // Notify supervisor directly if known
    if (req.supervisor_id) {
      await notifyUser(req.supervisor_id, {
        title: "New Request for Approval",
        message: `Request ${req.request_number} has been submitted for your approval`,
        type: "approval",
        reference_type: "request",
        reference_id: requestId,
      })
    } else {
      // Fallback: notify all approvers in office
      await notifyRoleInOffice(
        ["section_chief", "school_head", "division_chief"],
        req.office_id,
        {
          title: "New Request for Approval",
          message: `Request ${req.request_number} has been submitted for approval`,
          type: "approval",
          reference_type: "request",
          reference_id: requestId,
        }
      )
    }
  }

  revalidatePath("/dashboard/requests")
  return { error: null }
}

export async function approveRequest(
  input: ApproveRequestInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("approve_request", {
      p_request_id: input.request_id,
      p_remarks:    input.remarks ?? null,
    })

  if (error) {
    console.error("approveRequest error:", { id: input.request_id, error })
    return { error: error.message }
  }

  // Fetch request for notification context
  const { data: req } = await supabase
    .schema("procurements")
    .from("requests")
    .select("request_number, office_id, requested_by, division_id")
    .eq("id", input.request_id)
    .single()

  if (req) {
    // Notify requester
    await notifyUser(req.requested_by, {
      title: "Request Approved",
      message: `Your request ${req.request_number} has been approved by your supervisor`,
      type: "success",
      reference_type: "request",
      reference_id: input.request_id,
    })
    // Notify supply officers for processing
    await notifyRoleInOffice(
      ["supply_officer"],
      req.office_id,
      {
        title: "Request Ready for Processing",
        message: `Request ${req.request_number} has been approved and is ready for processing`,
        type: "approval",
        reference_type: "request",
        reference_id: input.request_id,
      }
    )
  }

  revalidatePath("/dashboard/requests")
  return { error: null }
}

export async function rejectRequest(
  input: RejectRequestInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("reject_request", {
      p_request_id: input.request_id,
      p_reason:     input.reason,
    })

  if (error) {
    console.error("rejectRequest error:", { id: input.request_id, error })
    return { error: error.message }
  }

  // Notify requester
  const { data: req } = await supabase
    .schema("procurements")
    .from("requests")
    .select("request_number, requested_by")
    .eq("id", input.request_id)
    .single()

  if (req) {
    await notifyUser(req.requested_by, {
      title: "Request Rejected",
      message: `Your request ${req.request_number} has been rejected: ${input.reason}`,
      type: "error",
      reference_type: "request",
      reference_id: input.request_id,
    })
  }

  revalidatePath("/dashboard/requests")
  return { error: null }
}

export async function cancelRequest(
  requestId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("cancel_request", { p_request_id: requestId })

  if (error) {
    console.error("cancelRequest error:", { requestId, error })
    return { error: error.message }
  }

  revalidatePath("/dashboard/requests")
  return { error: null }
}

export async function fulfillRequestFromStock(
  input: FulfillRequestInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("fulfill_request_from_stock", {
      p_request_id:        input.request_id,
      p_fulfillment_items: input.items.map(item => ({
        request_item_id:  item.request_item_id,
        inventory_id:     item.inventory_id,
        quantity_to_issue: item.quantity_to_issue,
      })),
    })

  if (error) {
    console.error("fulfillRequestFromStock error:", { id: input.request_id, error })
    return { error: error.message }
  }

  // Notify requester
  const { data: req } = await supabase
    .schema("procurements")
    .from("requests")
    .select("request_number, requested_by, status")
    .eq("id", input.request_id)
    .single()

  if (req) {
    await notifyUser(req.requested_by, {
      title: req.status === "fulfilled" ? "Request Fulfilled" : "Request Partially Fulfilled",
      message: req.status === "fulfilled"
        ? `Your request ${req.request_number} has been fully fulfilled from stock`
        : `Your request ${req.request_number} has been partially fulfilled from stock`,
      type: "success",
      reference_type: "request",
      reference_id: input.request_id,
    })
  }

  revalidatePath("/dashboard/requests")
  return { error: null }
}

export async function completeServiceRequest(
  input: CompleteServiceInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .rpc("complete_service_request", {
      p_request_id: input.request_id,
      p_remarks:    input.remarks ?? null,
    })

  if (error) {
    console.error("completeServiceRequest error:", { id: input.request_id, error })
    return { error: error.message }
  }

  // Notify requester
  const { data: req } = await supabase
    .schema("procurements")
    .from("requests")
    .select("request_number, requested_by")
    .eq("id", input.request_id)
    .single()

  if (req) {
    await notifyUser(req.requested_by, {
      title: "Service Request Completed",
      message: `Your service request ${req.request_number} has been completed`,
      type: "success",
      reference_type: "request",
      reference_id: input.request_id,
    })
  }

  revalidatePath("/dashboard/requests")
  return { error: null }
}

export async function routeRequestToProcurement(
  input: RouteToProcurementInput
): Promise<{ pr_id: string | null; error: string | null }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .schema("procurements")
    .rpc("route_request_to_procurement", {
      p_request_id:     input.request_id,
      p_fiscal_year_id: input.fiscal_year_id,
    })

  if (error) {
    console.error("routeRequestToProcurement error:", { id: input.request_id, error })
    return { pr_id: null, error: error.message }
  }

  // Notify requester
  const { data: req } = await supabase
    .schema("procurements")
    .from("requests")
    .select("request_number, requested_by")
    .eq("id", input.request_id)
    .single()

  if (req) {
    await notifyUser(req.requested_by, {
      title: "Request Routed to Procurement",
      message: `Your request ${req.request_number} has been routed to procurement for processing`,
      type: "info",
      reference_type: "request",
      reference_id: input.request_id,
    })
  }

  revalidatePath("/dashboard/requests")
  revalidatePath("/dashboard/procurement/purchase-requests")
  return { pr_id: data as string, error: null }
}
