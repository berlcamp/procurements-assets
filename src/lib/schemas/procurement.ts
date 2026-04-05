import { z } from "zod"

// ============================================================
// Supplier schemas
// ============================================================

export const supplierSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  trade_name: z.string().nullable().optional(),
  tin: z
    .string()
    .min(9, "TIN must be at least 9 characters")
    .regex(/^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/, "TIN format: 000-000-000 or 000-000-000-00000"),
  philgeps_number: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  province: z.string().nullable().optional(),
  zip_code: z.string().nullable().optional(),
  contact_person: z.string().nullable().optional(),
  contact_number: z.string().nullable().optional(),
  email: z
    .string()
    .email("Invalid email address")
    .nullable()
    .optional()
    .or(z.literal("")),
  website: z
    .string()
    .url("Invalid URL")
    .nullable()
    .optional()
    .or(z.literal("")),
  business_type: z.string().nullable().optional(),
  classification: z.array(z.string()),
})

export type SupplierInput = z.infer<typeof supplierSchema>

export const supplierBlacklistSchema = z.object({
  blacklist_reason: z.string().min(10, "Reason must be at least 10 characters"),
  blacklist_date: z.string().min(1, "Date is required"),
  blacklist_until: z.string().nullable().optional(),
})

export type SupplierBlacklistInput = z.infer<typeof supplierBlacklistSchema>

// ============================================================
// PR line item schema
// ============================================================

export const prItemSchema = z.object({
  item_number: z.number().int().positive(),
  description: z.string().min(3, "Description is required (min 3 characters)"),
  unit: z.string().min(1, "Unit is required"),
  quantity: z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
      message: "Quantity must be greater than zero",
    }),
  estimated_unit_cost: z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
      message: "Unit cost must be non-negative",
    }),
  remarks: z.string().nullable().optional(),
})

export type PrItemInput = z.infer<typeof prItemSchema>

// ============================================================
// Purchase Request schemas
// ============================================================

export const createPrSchema = z.object({
  office_id: z.string().uuid("Office is required"),
  fiscal_year_id: z.string().uuid("Fiscal year is required"),
  purpose: z.string().min(10, "Purpose must be at least 10 characters"),
  app_item_id: z.string().uuid("APP item is required"),
  fund_source_id: z.string().uuid().nullable().optional(),
  budget_allocation_id: z.string().uuid().nullable().optional(),
  items: z.array(prItemSchema).min(1, "At least one line item is required"),
})

export type CreatePrInput = z.infer<typeof createPrSchema>

export const updatePrItemsSchema = z.object({
  items: z.array(prItemSchema).min(1, "At least one line item is required"),
})

export type UpdatePrItemsInput = z.infer<typeof updatePrItemsSchema>

// ============================================================
// Workflow action schemas
// ============================================================

export const prCertifySchema = z.object({
  remarks: z.string().nullable().optional(),
})

export type PrCertifyInput = z.infer<typeof prCertifySchema>

export const prApproveSchema = z.object({
  remarks: z.string().nullable().optional(),
})

export type PrApproveInput = z.infer<typeof prApproveSchema>

export const prReturnSchema = z.object({
  reason: z.string().min(5, "A reason of at least 5 characters is required"),
})

export type PrReturnInput = z.infer<typeof prReturnSchema>

export const prCancelSchema = z.object({
  cancellation_reason: z.string().min(10, "Cancellation reason must be at least 10 characters"),
})

export type PrCancelInput = z.infer<typeof prCancelSchema>

// ============================================================
// Labels and options
// ============================================================

export const PR_STATUS_LABELS: Record<string, string> = {
  draft:            "Draft",
  submitted:        "Submitted",
  budget_certified: "Budget Certified",
  approved:         "Approved",
  in_procurement:   "In Procurement",
  completed:        "Completed",
  cancelled:        "Cancelled",
}

export const SUPPLIER_STATUS_LABELS: Record<string, string> = {
  active:      "Active",
  blacklisted: "Blacklisted",
  suspended:   "Suspended",
  inactive:    "Inactive",
}

export const OBR_STATUS_LABELS: Record<string, string> = {
  pending:   "Pending",
  certified: "Certified",
  obligated: "Obligated",
  cancelled: "Cancelled",
}

export const SUPPLIER_CLASSIFICATION_OPTIONS = [
  "Goods",
  "Infrastructure",
  "Consulting Services",
  "IT Equipment",
  "Office Supplies",
  "Janitorial",
  "Security Services",
  "Medical/Dental",
  "Training",
  "Printing",
] as const

export const BUSINESS_TYPE_OPTIONS = [
  "Sole Proprietorship",
  "Partnership",
  "Corporation",
  "Cooperative",
  "Government Agency",
  "Foreign Corporation",
] as const
