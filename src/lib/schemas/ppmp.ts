import "./zod-config"
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
// PPMP Project (GPPB Columns 1-2)
// ============================================================

export const ppmpProjectSchema = z.object({
  general_description: z.string().min(10, "Description must be at least 10 characters"),
  project_type: z.enum(
    ['goods', 'infrastructure', 'consulting_services'],
    { error: "Project type is required" }
  ),
})

export type PpmpProjectInput = z.infer<typeof ppmpProjectSchema>

// ============================================================
// PPMP Lot (GPPB Columns 3-12)
// ============================================================

export const ppmpLotSchema = z.object({
  lot_title: z.string().nullable().optional(),
  procurement_mode: z.enum([
    'competitive_bidding', 'limited_source_bidding', 'direct_contracting',
    'repeat_order', 'shopping', 'svp', 'negotiated', 'agency_to_agency', 'emergency',
  ], { message: "Procurement mode is required" }),
  pre_procurement_conference: z.boolean().default(false),
  is_cse: z.boolean().default(false),
  procurement_start: z.string().nullable().optional(),
  procurement_end: z.string().nullable().optional(),
  delivery_period: z.string().nullable().optional(),
  schedule_quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']).nullable().optional(),
  advertisement_date: z.string().nullable().optional(),
  bid_opening_date: z.string().nullable().optional(),
  award_date: z.string().nullable().optional(),
  contract_signing_date: z.string().nullable().optional(),
  source_of_funds: z.string().nullable().optional(),
  estimated_budget: z
    .string()
    .min(1, "Estimated budget is required")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
      message: "Budget must be greater than zero",
    }),
  supporting_documents: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  budget_allocation_id: z.string().uuid().nullable().optional(),
})

export type PpmpLotInput = z.infer<typeof ppmpLotSchema>

// ============================================================
// PPMP Lot Item (items within Column 3)
// ============================================================

export const ppmpLotItemSchema = z.object({
  description: z.string().min(3, "Description must be at least 3 characters"),
  quantity: z
    .string()
    .min(1, "Quantity is required")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
      message: "Quantity must be greater than zero",
    }),
  unit: z.string().min(1, "Unit is required"),
  specification: z.string().nullable().optional(),
  estimated_unit_cost: z
    .string()
    .min(1, "Unit cost is required")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
      message: "Unit cost must be a non-negative number",
    }),
})

export type PpmpLotItemInput = z.infer<typeof ppmpLotItemSchema>

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

export const PPMP_PROJECT_TYPE_LABELS: Record<string, string> = {
  goods:                "Goods",
  infrastructure:       "Infrastructure",
  consulting_services:  "Consulting Services",
}

export const PROCUREMENT_MODES = [
  { value: "competitive_bidding",    label: "Competitive Bidding" },
  { value: "limited_source_bidding", label: "Limited Source Bidding" },
  { value: "direct_contracting",     label: "Direct Contracting" },
  { value: "repeat_order",           label: "Repeat Order" },
  { value: "shopping",               label: "Shopping" },
  { value: "svp",                    label: "Small Value Procurement" },
  { value: "negotiated",             label: "Negotiated Procurement" },
  { value: "agency_to_agency",       label: "Agency-to-Agency" },
  { value: "emergency",              label: "Emergency Purchase" },
]

export const SCHEDULE_QUARTERS = [
  { value: "Q1", label: "Q1 (Jan-Mar)" },
  { value: "Q2", label: "Q2 (Apr-Jun)" },
  { value: "Q3", label: "Q3 (Jul-Sep)" },
  { value: "Q4", label: "Q4 (Oct-Dec)" },
]
