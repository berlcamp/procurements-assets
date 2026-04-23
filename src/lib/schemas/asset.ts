import "./zod-config"
import { z } from "zod"

// ============================================================
// Constants & Labels
// ============================================================

export const ASSET_TYPES = ['semi_expendable', 'ppe'] as const

export const ASSET_TYPE_LABELS: Record<string, string> = {
  semi_expendable: 'Semi-Expendable',
  ppe: 'Property, Plant & Equipment',
}

export const CONDITION_STATUSES = ['serviceable', 'needs_repair', 'unserviceable', 'disposed'] as const

export const CONDITION_STATUS_LABELS: Record<string, string> = {
  serviceable: 'Serviceable',
  needs_repair: 'Needs Repair',
  unserviceable: 'Unserviceable',
  disposed: 'Disposed',
}

export const ASSET_STATUSES = ['active', 'transferred', 'for_disposal', 'disposed', 'lost', 'donated'] as const

export const ASSET_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  transferred: 'Transferred',
  for_disposal: 'For Disposal',
  disposed: 'Disposed',
  lost: 'Lost',
  donated: 'Donated',
}

export const ASSIGNMENT_DOC_TYPES = ['par', 'ics'] as const

export const DOC_TYPE_LABELS: Record<string, string> = {
  par: 'PAR',
  ics: 'ICS',
}

export const DOC_TYPE_FULL_LABELS: Record<string, string> = {
  par: 'Property Acknowledgement Receipt',
  ics: 'Inventory Custodian Slip',
}

export const DISPOSAL_METHODS = [
  'sale',
  'transfer',
  'donation',
  'destruction',
  'barter',
  'condemnation',
] as const

export const DISPOSAL_METHOD_LABELS: Record<string, string> = {
  sale: 'Sale',
  transfer: 'Transfer to Other Agency',
  donation: 'Donation',
  destruction: 'Destruction',
  barter: 'Barter',
  condemnation: 'Condemnation',
}

// ============================================================
// Register Asset from Delivery schema
// ============================================================

export const registerAssetFromDeliverySchema = z.object({
  delivery_item_id: z.string().uuid("Delivery item is required"),
  brand_model: z.string().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  custodian_id: z.string().uuid().nullable().optional(),
  residual_value: z.number().min(0).nullable().optional(),
  useful_life_years: z.number().int().min(1).nullable().optional(),
  acquisition_date: z.string().nullable().optional(),
})

export type RegisterAssetFromDeliveryInput = z.infer<typeof registerAssetFromDeliverySchema>

// ============================================================
// Register Asset Manual schema
// ============================================================

export const registerAssetManualSchema = z.object({
  item_catalog_id: z.string().uuid("Item catalog entry is required"),
  office_id: z.string().uuid("Office is required"),
  description: z.string().min(1, "Description is required"),
  brand_model: z.string().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  acquisition_date: z.string().min(1, "Acquisition date is required"),
  acquisition_cost: z.number().positive("Acquisition cost must be positive"),
  asset_type: z.enum(ASSET_TYPES, { message: "Asset type is required" }),
  location: z.string().nullable().optional(),
  custodian_id: z.string().uuid().nullable().optional(),
  useful_life_years: z.number().int().min(1).nullable().optional(),
  residual_value: z.number().min(0).nullable().optional(),
}).refine(
  (data) => {
    if (data.residual_value != null && data.residual_value > data.acquisition_cost) return false
    return true
  },
  { message: "Residual value cannot exceed acquisition cost", path: ["residual_value"] }
)

export type RegisterAssetManualInput = z.infer<typeof registerAssetManualSchema>

// ============================================================
// Transfer Asset schema
// ============================================================

export const transferAssetSchema = z.object({
  asset_id: z.string().uuid(),
  new_custodian_id: z.string().uuid("New custodian is required"),
  new_office_id: z.string().uuid().nullable().optional(),
  remarks: z.string().nullable().optional(),
})

export type TransferAssetInput = z.infer<typeof transferAssetSchema>

// ============================================================
// Update Condition schema
// ============================================================

export const updateConditionSchema = z.object({
  condition_status: z.enum(CONDITION_STATUSES, {
    message: "Condition status is required",
  }),
  remarks: z.string().nullable().optional(),
})

export type UpdateConditionInput = z.infer<typeof updateConditionSchema>

// ============================================================
// Disposal schemas
// ============================================================

export const initiateDisposalSchema = z.object({
  method: z.enum(DISPOSAL_METHODS, { message: "Disposal method is required" }),
  remarks: z.string().nullable().optional(),
})

export type InitiateDisposalInput = z.infer<typeof initiateDisposalSchema>

export const completeDisposalSchema = z.object({
  disposal_reference: z.string().min(1, "Disposal reference is required"),
})

export type CompleteDisposalInput = z.infer<typeof completeDisposalSchema>

// ============================================================
// Run Depreciation schema
// ============================================================

export const runDepreciationSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
})

export type RunDepreciationInput = z.infer<typeof runDepreciationSchema>
