import { z } from "zod"

// ============================================================
// PPMP Header (create / edit)
// ============================================================

export const ppmpHeaderSchema = z.object({
  office_id: z.string().uuid("Office is required"),
  fiscal_year_id: z.string().uuid("Fiscal year is required"),
})

export type PpmpHeaderInput = z.infer<typeof ppmpHeaderSchema>

// ============================================================
// PPMP Item
// ============================================================

export const ppmpItemSchema = z.object({
  category: z.enum(
    ['common_use_supplies', 'non_common_supplies', 'equipment', 'services', 'infrastructure'],
    { error: "Category is required" }
  ),
  description: z.string().min(3, "Description must be at least 3 characters"),
  unit: z.string().min(1, "Unit is required"),
  quantity: z
    .string()
    .min(1, "Quantity is required")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
      message: "Quantity must be greater than zero",
    }),
  estimated_unit_cost: z
    .string()
    .min(1, "Unit cost is required")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
      message: "Unit cost must be a non-negative number",
    }),
  procurement_method: z.string().min(1, "Procurement method is required"),
  budget_allocation_id: z.string().uuid().nullable().optional(),
  schedule_q1: z.string().default("0"),
  schedule_q2: z.string().default("0"),
  schedule_q3: z.string().default("0"),
  schedule_q4: z.string().default("0"),
  is_cse: z.boolean().default(false),
  remarks: z.string().nullable().optional(),
}).refine(
  (data) => {
    const total = parseFloat(data.quantity)
    const sum =
      parseFloat(data.schedule_q1 || "0") +
      parseFloat(data.schedule_q2 || "0") +
      parseFloat(data.schedule_q3 || "0") +
      parseFloat(data.schedule_q4 || "0")
    return Math.abs(total - sum) < 0.0001
  },
  {
    message: "Q1 + Q2 + Q3 + Q4 must equal total quantity",
    path: ["schedule_q4"],
  }
)

export type PpmpItemInput = z.infer<typeof ppmpItemSchema>

// ============================================================
// Amendment
// ============================================================

export const ppmpAmendmentSchema = z.object({
  justification: z.string().min(20, "Justification must be at least 20 characters"),
})

export type PpmpAmendmentInput = z.infer<typeof ppmpAmendmentSchema>

// ============================================================
// Review actions
// ============================================================

export const ppmpChiefReviewSchema = z.object({
  action: z.enum(['forward', 'return']),
  notes: z.string().nullable().optional(),
})

export type PpmpChiefReviewInput = z.infer<typeof ppmpChiefReviewSchema>

export const ppmpCertifySchema = z.object({
  notes: z.string().nullable().optional(),
})

export type PpmpCertifyInput = z.infer<typeof ppmpCertifySchema>

export const ppmpApproveSchema = z.object({
  notes: z.string().nullable().optional(),
})

export type PpmpApproveInput = z.infer<typeof ppmpApproveSchema>

export const ppmpReturnSchema = z.object({
  step: z.enum(['to_end_user', 'to_chief', 'to_budget']),
  notes: z.string().min(5, "Please provide a reason for returning"),
})

export type PpmpReturnInput = z.infer<typeof ppmpReturnSchema>

// ============================================================
// Labels
// ============================================================

export const PPMP_STATUS_LABELS: Record<string, string> = {
  draft:             "Draft",
  submitted:         "Submitted",
  chief_reviewed:    "Chief Reviewed",
  budget_certified:  "Budget Certified",
  approved:          "Approved",
  revision_required: "Revision Required",
  locked:            "Locked",
}

export const PPMP_VERSION_TYPE_LABELS: Record<string, string> = {
  original:      "Original",
  amendment:     "Amendment",
  supplemental:  "Supplemental",
}

export const PPMP_ITEM_CATEGORY_LABELS: Record<string, string> = {
  common_use_supplies:  "Common Use Supplies (DBM-PS)",
  non_common_supplies:  "Non-Common Supplies",
  equipment:            "Equipment",
  services:             "Services",
  infrastructure:       "Infrastructure",
}

export const PROCUREMENT_METHODS = [
  { value: "shopping",                   label: "Shopping" },
  { value: "small_value",                label: "Small Value Procurement" },
  { value: "negotiated",                 label: "Negotiated Procurement" },
  { value: "public_bidding",             label: "Competitive Bidding" },
  { value: "direct_contracting",         label: "Direct Contracting" },
  { value: "repeat_order",               label: "Repeat Order" },
  { value: "limited_source_bidding",     label: "Limited Source Bidding" },
  { value: "two_stage_bidding",          label: "Two-Stage Bidding" },
]
