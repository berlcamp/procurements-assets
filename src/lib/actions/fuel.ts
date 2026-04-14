"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  FuelType,
  FuelInventoryWithDetails,
  FuelStockMovementWithDetails,
  FuelRequestWithDetails,
} from "@/types/database"
import type {
  CreateFuelRequestInput,
  ApproveFuelRequestInput,
  RejectFuelRequestInput,
  FuelManualStockInInput,
  FuelStockAdjustmentInput,
  FuelTypeInput,
} from "@/lib/schemas/fuel"
import {
  notifyUser,
  notifyRoleInOffice,
} from "@/lib/actions/helpers"

// ============================================================
// Select strings
// ============================================================

const FUEL_REQUEST_SELECT = `
  *,
  office:offices(id, name, code),
  fuel_type:fuel_types(id, name, unit, price_per_unit),
  requested_by_profile:user_profiles!requested_by(id, first_name, last_name, position),
  approved_by_profile:user_profiles!approved_by(id, first_name, last_name)
` as const

const FUEL_INVENTORY_SELECT = `
  *,
  fuel_type:fuel_types(id, name, unit, price_per_unit),
  office:offices(id, name, code)
` as const

const FUEL_MOVEMENT_SELECT = `
  *,
  fuel_inventory:fuel_inventory(
    id, fuel_type_id, office_id,
    fuel_type:fuel_types(id, name, unit)
  ),
  created_by_profile:user_profiles!created_by(id, first_name, last_name)
` as const

// ============================================================
// Fuel Type queries
// ============================================================

export async function getFuelTypes(): Promise<FuelType[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("fuel_types")
    .select("*")
    .is("deleted_at", null)
    .order("name")

  if (error) {
    console.error("getFuelTypes error:", error)
    return []
  }
  return (data ?? []) as FuelType[]
}

export async function createFuelType(
  input: FuelTypeInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .single()

  if (!profile?.division_id) return { error: "No division assigned" }

  const { data, error } = await supabase
    .schema("procurements")
    .from("fuel_types")
    .insert({
      division_id: profile.division_id,
      name: input.name,
      unit: input.unit,
      price_per_unit: input.price_per_unit ?? null,
      is_active: input.is_active,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) {
    console.error("createFuelType error:", error)
    if (error.code === "23505") return { error: "A fuel type with this name already exists" }
    return { error: error.message }
  }

  revalidatePath("/dashboard/fuel")
  return { error: null, id: data?.id }
}

export async function updateFuelType(
  id: string,
  input: FuelTypeInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("fuel_types")
    .update({
      name: input.name,
      unit: input.unit,
      price_per_unit: input.price_per_unit ?? null,
      is_active: input.is_active,
    })
    .eq("id", id)

  if (error) {
    console.error("updateFuelType error:", error)
    if (error.code === "23505") return { error: "A fuel type with this name already exists" }
    return { error: error.message }
  }

  revalidatePath("/dashboard/fuel")
  return { error: null }
}

// ============================================================
// Fuel Inventory queries
// ============================================================

export async function getFuelInventoryList(
  officeId?: string
): Promise<FuelInventoryWithDetails[]> {
  const supabase = await createClient()
  let query = supabase
    .schema("procurements")
    .from("fuel_inventory")
    .select(FUEL_INVENTORY_SELECT)
    .is("deleted_at", null)

  if (officeId) {
    query = query.eq("office_id", officeId)
  }

  const { data, error } = await query.order("created_at", { ascending: false })

  if (error) {
    console.error("getFuelInventoryList error:", error)
    return []
  }
  return (data ?? []) as FuelInventoryWithDetails[]
}

export async function getFuelInventoryById(
  id: string
): Promise<FuelInventoryWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("fuel_inventory")
    .select(FUEL_INVENTORY_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle()

  if (error) {
    console.error("getFuelInventoryById error:", error)
    return null
  }
  return data as FuelInventoryWithDetails | null
}

export async function getFuelStockMovements(
  fuelInventoryId: string
): Promise<FuelStockMovementWithDetails[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("fuel_stock_movements")
    .select(FUEL_MOVEMENT_SELECT)
    .eq("fuel_inventory_id", fuelInventoryId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getFuelStockMovements error:", error)
    return []
  }
  return (data ?? []) as FuelStockMovementWithDetails[]
}

export async function getFuelLowStockAlerts(): Promise<FuelInventoryWithDetails[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("fuel_inventory")
    .select(FUEL_INVENTORY_SELECT)
    .is("deleted_at", null)
    .filter("current_liters", "lte", "reorder_point")

  if (error) {
    console.error("getFuelLowStockAlerts error:", error)
    return []
  }
  return (data ?? []) as FuelInventoryWithDetails[]
}

// ============================================================
// Fuel Inventory mutations
// ============================================================

export async function fuelManualStockIn(
  input: FuelManualStockInInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("fuel_manual_stock_in", {
      p_fuel_type_id: input.fuel_type_id,
      p_office_id: input.office_id,
      p_quantity: input.quantity_liters,
      p_remarks: input.remarks ?? null,
    })

  if (error) {
    console.error("fuelManualStockIn error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/fuel")
  return { error: null, id: data as string }
}

export async function fuelStockAdjustment(
  input: FuelStockAdjustmentInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("fuel_stock_adjustment", {
      p_fuel_inventory_id: input.fuel_inventory_id,
      p_new_quantity: input.new_quantity,
      p_remarks: input.remarks ?? null,
    })

  if (error) {
    console.error("fuelStockAdjustment error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/fuel")
  return { error: null }
}

// ============================================================
// Fuel Request queries
// ============================================================

export async function getMyFuelRequests(): Promise<FuelRequestWithDetails[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .schema("procurements")
    .from("fuel_requests")
    .select(FUEL_REQUEST_SELECT)
    .eq("requested_by", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("getMyFuelRequests error:", error)
    return []
  }
  return (data ?? []) as FuelRequestWithDetails[]
}

export async function getPendingFuelApprovals(): Promise<FuelRequestWithDetails[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("fuel_requests")
    .select(FUEL_REQUEST_SELECT)
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })

  if (error) {
    console.error("getPendingFuelApprovals error:", error)
    return []
  }
  return (data ?? []) as FuelRequestWithDetails[]
}

export async function getAllFuelRequests(filters?: {
  status?: string
  office_id?: string
  fuel_type_id?: string
}): Promise<FuelRequestWithDetails[]> {
  const supabase = await createClient()
  let query = supabase
    .schema("procurements")
    .from("fuel_requests")
    .select(FUEL_REQUEST_SELECT)
    .is("deleted_at", null)

  if (filters?.status) query = query.eq("status", filters.status)
  if (filters?.office_id) query = query.eq("office_id", filters.office_id)
  if (filters?.fuel_type_id) query = query.eq("fuel_type_id", filters.fuel_type_id)

  const { data, error } = await query.order("created_at", { ascending: false })

  if (error) {
    console.error("getAllFuelRequests error:", error)
    return []
  }
  return (data ?? []) as FuelRequestWithDetails[]
}

export async function getFuelRequestById(
  id: string
): Promise<FuelRequestWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("fuel_requests")
    .select(FUEL_REQUEST_SELECT)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle()

  if (error) {
    console.error("getFuelRequestById error:", error)
    return null
  }
  return data as FuelRequestWithDetails | null
}

// ============================================================
// Fuel Summary (dashboard stats)
// ============================================================

export async function getFuelSummary(): Promise<{
  totalStockLiters: number
  pendingRequests: number
  approvedThisMonth: number
  lowStockCount: number
}> {
  const supabase = await createClient()

  const [inventoryRes, pendingRes, approvedRes, lowStockRes] = await Promise.all([
    supabase
      .schema("procurements")
      .from("fuel_inventory")
      .select("current_liters")
      .is("deleted_at", null),
    supabase
      .schema("procurements")
      .from("fuel_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .is("deleted_at", null),
    supabase
      .schema("procurements")
      .from("fuel_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .is("deleted_at", null)
      .gte("approved_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    supabase
      .schema("procurements")
      .from("fuel_inventory")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .filter("current_liters", "lte", "reorder_point"),
  ])

  const totalStockLiters = (inventoryRes.data ?? []).reduce(
    (sum, r) => sum + parseFloat(r.current_liters as string),
    0
  )

  return {
    totalStockLiters,
    pendingRequests: pendingRes.count ?? 0,
    approvedThisMonth: approvedRes.count ?? 0,
    lowStockCount: lowStockRes.count ?? 0,
  }
}

// ============================================================
// Fuel Consumption Report
// ============================================================

export async function getFuelConsumptionReport(
  startDate: string,
  endDate: string,
  officeId?: string
): Promise<FuelRequestWithDetails[]> {
  const supabase = await createClient()
  let query = supabase
    .schema("procurements")
    .from("fuel_requests")
    .select(FUEL_REQUEST_SELECT)
    .in("status", ["approved", "dispensed"])
    .is("deleted_at", null)
    .gte("approved_at", startDate)
    .lte("approved_at", endDate)

  if (officeId) query = query.eq("office_id", officeId)

  const { data, error } = await query.order("approved_at", { ascending: false })

  if (error) {
    console.error("getFuelConsumptionReport error:", error)
    return []
  }
  return (data ?? []) as FuelRequestWithDetails[]
}

// ============================================================
// Fuel Request mutations
// ============================================================

export async function createFuelRequest(
  input: CreateFuelRequestInput
): Promise<{ error: string | null; id?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .single()

  if (!profile?.division_id) return { error: "No division assigned" }

  // Generate request number
  const { data: reqNumber, error: numError } = await supabase
    .schema("procurements")
    .rpc("generate_fuel_request_number", {
      p_office_id: input.office_id,
      p_division_id: profile.division_id,
    })

  if (numError) {
    console.error("generate_fuel_request_number error:", numError)
    return { error: numError.message }
  }

  const { data, error } = await supabase
    .schema("procurements")
    .from("fuel_requests")
    .insert({
      division_id: profile.division_id,
      request_number: reqNumber as string,
      office_id: input.office_id,
      requested_by: user.id,
      fuel_type_id: input.fuel_type_id,
      date_of_trip: input.date_of_trip,
      destination: input.destination,
      purpose: input.purpose,
      vehicle_type: input.vehicle_type,
      vehicle_plate_number: input.vehicle_plate_number,
      passengers: input.passengers,
      liters_requested: input.liters_requested,
      km_departure: typeof input.km_departure === "number" ? input.km_departure : null,
      status: "pending",
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) {
    console.error("createFuelRequest error:", error)
    return { error: error.message }
  }

  // Notify fuel managers in the office
  await notifyRoleInOffice(
    ["fuel_manager", "supply_officer"],
    input.office_id,
    {
      title: "New Fuel Request",
      message: `A new fuel request (${reqNumber}) has been submitted and is awaiting approval.`,
      type: "approval",
      reference_type: "fuel_request",
      reference_id: data.id,
    }
  )

  revalidatePath("/dashboard/fuel")
  return { error: null, id: data.id }
}

export async function approveFuelRequest(
  input: ApproveFuelRequestInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("approve_fuel_request", {
      p_request_id: input.request_id,
      p_liters_approved: input.liters_approved ?? null,
      p_remarks: input.remarks ?? null,
    })

  if (error) {
    console.error("approveFuelRequest error:", error)
    return { error: error.message }
  }

  // Fetch request to notify requester
  const request = await getFuelRequestById(input.request_id)
  if (request) {
    await notifyUser(request.requested_by, {
      title: "Fuel Request Approved",
      message: `Your fuel request (${request.request_number}) has been approved. You may now print the voucher slip.`,
      type: "success",
      reference_type: "fuel_request",
      reference_id: input.request_id,
    })
  }

  revalidatePath("/dashboard/fuel")
  return { error: null }
}

export async function rejectFuelRequest(
  input: RejectFuelRequestInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("reject_fuel_request", {
      p_request_id: input.request_id,
      p_reason: input.reason,
    })

  if (error) {
    console.error("rejectFuelRequest error:", error)
    return { error: error.message }
  }

  // Fetch request to notify requester
  const request = await getFuelRequestById(input.request_id)
  if (request) {
    await notifyUser(request.requested_by, {
      title: "Fuel Request Rejected",
      message: `Your fuel request (${request.request_number}) was rejected. Reason: ${input.reason}`,
      type: "error",
      reference_type: "fuel_request",
      reference_id: input.request_id,
    })
  }

  revalidatePath("/dashboard/fuel")
  return { error: null }
}

export async function cancelFuelRequest(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("cancel_fuel_request", { p_request_id: id })

  if (error) {
    console.error("cancelFuelRequest error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/fuel")
  return { error: null }
}

export async function dispenseFuelRequest(
  id: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("dispense_fuel_request", { p_request_id: id })

  if (error) {
    console.error("dispenseFuelRequest error:", error)
    return { error: error.message }
  }

  revalidatePath("/dashboard/fuel")
  return { error: null }
}
