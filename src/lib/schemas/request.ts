import { z } from "zod"

// ============================================================
// Constants & Labels
// ============================================================

export const REQUEST_TYPES = ['supply', 'equipment', 'service', 'procurement'] as const
export const REQUEST_TYPE_LABELS: Record<string, string> = {
  supply: 'Supply (RIS)',
  equipment: 'Equipment',
  service: 'Service / Maintenance',
  procurement: 'Procurement',
}

export const URGENCY_LEVELS = ['low', 'normal', 'high', 'emergency'] as const
export const URGENCY_LABELS: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  emergency: 'Emergency',
}

export const REQUEST_STATUSES = [
  'draft', 'submitted', 'supervisor_approved',
  'processing', 'partially_fulfilled', 'fulfilled',
  'rejected', 'cancelled',
] as const
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  supervisor_approved: 'Supervisor Approved',
  processing: 'Processing',
  partially_fulfilled: 'Partially Fulfilled',
  fulfilled: 'Fulfilled',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export const FULFILLMENT_TYPE_LABELS: Record<string, string> = {
  stock: 'From Stock',
  procurement: 'Routed to Procurement',
  mixed: 'Mixed (Stock + Procurement)',
}

// ============================================================
// Schemas
// ============================================================

export const requestItemSchema = z.object({
  item_catalog_id: z.string().uuid().nullable().optional(),
  description: z.string().min(2, "Description is required"),
  unit: z.string().min(1, "Unit is required"),
  quantity_requested: z.number().positive("Quantity must be greater than zero"),
  remarks: z.string().nullable().optional(),
})

export type RequestItemInput = z.infer<typeof requestItemSchema>

export const createRequestSchema = z.object({
  request_type: z.enum(REQUEST_TYPES),
  office_id: z.string().uuid("Office is required"),
  purpose: z.string().min(5, "Purpose must be at least 5 characters"),
  urgency: z.enum(URGENCY_LEVELS),
  items: z.array(requestItemSchema).min(1, "At least one item is required"),
})

export type CreateRequestInput = z.infer<typeof createRequestSchema>

export const approveRequestSchema = z.object({
  request_id: z.string().uuid(),
  remarks: z.string().nullable().optional(),
})

export type ApproveRequestInput = z.infer<typeof approveRequestSchema>

export const rejectRequestSchema = z.object({
  request_id: z.string().uuid(),
  reason: z.string().min(5, "Rejection reason must be at least 5 characters"),
})

export type RejectRequestInput = z.infer<typeof rejectRequestSchema>

export const fulfillItemSchema = z.object({
  request_item_id: z.string().uuid(),
  inventory_id: z.string().uuid(),
  quantity_to_issue: z.number().positive("Quantity must be greater than zero"),
})

export const fulfillRequestSchema = z.object({
  request_id: z.string().uuid(),
  items: z.array(fulfillItemSchema).min(1, "At least one item to fulfill"),
})

export type FulfillRequestInput = z.infer<typeof fulfillRequestSchema>

export const routeToProcurementSchema = z.object({
  request_id: z.string().uuid(),
  fiscal_year_id: z.string().uuid("Fiscal year is required"),
})

export type RouteToProcurementInput = z.infer<typeof routeToProcurementSchema>

export const completeServiceSchema = z.object({
  request_id: z.string().uuid(),
  remarks: z.string().nullable().optional(),
})

export type CompleteServiceInput = z.infer<typeof completeServiceSchema>
