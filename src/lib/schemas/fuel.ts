import { z } from "zod"

// ============================================================
// Constants
// ============================================================

export const FUEL_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "dispensed",
] as const

export const FUEL_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  dispensed: "Dispensed",
}

export const FUEL_STATUS_COLORS: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  cancelled: "outline",
  dispensed: "default",
}

export const VEHICLE_TYPES = [
  "Service Vehicle",
  "Motorcycle",
  "Pick-up",
  "Bus",
  "Van",
  "Other",
] as const

export const FUEL_MOVEMENT_TYPE_LABELS: Record<string, string> = {
  stock_in: "Stock In",
  stock_out: "Stock Out (Fuel Request)",
  adjustment: "Adjustment",
}

// ============================================================
// Schemas
// ============================================================

export const passengerSchema = z.object({
  name: z.string().min(1, "Passenger name is required"),
  position: z.string().min(1, "Position is required"),
})

export const createFuelRequestSchema = z.object({
  office_id: z.string().uuid(),
  fuel_type_id: z.string().uuid("Please select a fuel type"),
  date_of_trip: z.string().min(1, "Date of trip is required"),
  destination: z.string().min(2, "Destination is required"),
  purpose: z.string().min(5, "Purpose must be at least 5 characters"),
  vehicle_type: z.string().min(1, "Vehicle type is required"),
  vehicle_plate_number: z.string().min(1, "Plate number is required"),
  passengers: z.array(passengerSchema),
  liters_requested: z
    .number()
    .positive("Liters requested must be greater than zero"),
  km_departure: z.number().min(0).optional(),
})

export type CreateFuelRequestInput = z.infer<typeof createFuelRequestSchema>

export const approveFuelRequestSchema = z.object({
  request_id: z.string().uuid(),
  liters_approved: z.number().positive().optional(),
  remarks: z.string().nullable().optional(),
})

export type ApproveFuelRequestInput = z.infer<typeof approveFuelRequestSchema>

export const rejectFuelRequestSchema = z.object({
  request_id: z.string().uuid(),
  reason: z
    .string()
    .min(5, "Rejection reason must be at least 5 characters"),
})

export type RejectFuelRequestInput = z.infer<typeof rejectFuelRequestSchema>

export const fuelManualStockInSchema = z.object({
  fuel_type_id: z.string().uuid("Please select a fuel type"),
  office_id: z.string().uuid("Please select an office"),
  quantity_liters: z
    .number()
    .positive("Quantity must be greater than zero"),
  price_per_liter: z.number().positive("Price must be greater than zero").optional(),
  po_number: z.string().optional(),
  remarks: z.string().nullable().optional(),
})

export type FuelManualStockInInput = z.infer<typeof fuelManualStockInSchema>

export const fuelStockAdjustmentSchema = z.object({
  fuel_inventory_id: z.string().uuid(),
  new_quantity: z.number().min(0, "Quantity cannot be negative"),
  remarks: z.string().nullable().optional(),
})

export type FuelStockAdjustmentInput = z.infer<
  typeof fuelStockAdjustmentSchema
>

export const fuelTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  unit: z.string().min(1).default("liters"),
  price_per_unit: z.number().min(0).nullable().optional(),
  is_active: z.boolean().default(true),
})

export type FuelTypeInput = z.infer<typeof fuelTypeSchema>
