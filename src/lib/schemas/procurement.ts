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
  app_item_id: z.string().uuid("APP item is required"),
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

// ============================================================
// Phase 8: Procurement Activity schemas
// ============================================================

export const createProcurementSchema = z.object({
  purchase_request_id: z.string().uuid("Purchase Request is required"),
  procurement_method: z.enum(["svp", "shopping"], {
    message: "Procurement method is required",
  }),
})

export type CreateProcurementInput = z.infer<typeof createProcurementSchema>

export const bidItemSchema = z.object({
  pr_item_id: z.string().uuid(),
  offered_unit_cost: z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
      message: "Offered unit cost must be greater than zero",
    }),
  offered_total_cost: z
    .string()
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
      message: "Offered total cost must be greater than zero",
    }),
  brand_model: z.string().nullable().optional(),
  specifications: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
})

export type BidItemInput = z.infer<typeof bidItemSchema>

export const recordBidSchema = z.object({
  procurement_id: z.string().uuid(),
  supplier_id: z.string().uuid("Supplier is required"),
  items: z.array(bidItemSchema).min(1, "At least one bid item is required"),
})

export type RecordBidInput = z.infer<typeof recordBidSchema>

export const bidEvaluationItemSchema = z.object({
  bid_id: z.string().uuid(),
  is_responsive: z.boolean(),
  is_eligible: z.boolean(),
  is_compliant: z.boolean(),
  evaluation_score: z
    .string()
    .refine((v) => v === "" || (!isNaN(parseFloat(v)) && parseFloat(v) >= 0 && parseFloat(v) <= 100), {
      message: "Score must be between 0 and 100",
    })
    .nullable()
    .optional(),
  remarks: z.string().nullable().optional(),
})

export const evaluateBidsSchema = z.object({
  procurement_id: z.string().uuid(),
  evaluations: z.array(bidEvaluationItemSchema).min(1, "At least one evaluation is required"),
})

export type EvaluateBidsInput = z.infer<typeof evaluateBidsSchema>

export const awardProcurementSchema = z.object({
  procurement_id: z.string().uuid(),
  bid_id: z.string().uuid("Winning bid is required"),
})

export type AwardProcurementInput = z.infer<typeof awardProcurementSchema>

export const approveAwardSchema = z.object({
  notes: z.string().nullable().optional(),
})

export type ApproveAwardInput = z.infer<typeof approveAwardSchema>

export const failProcurementSchema = z.object({
  reason: z.string().min(5, "A reason of at least 5 characters is required"),
})

export type FailProcurementInput = z.infer<typeof failProcurementSchema>

export const advanceStageSchema = z.object({
  next_stage: z.string().min(1, "Target stage is required"),
  notes: z.string().nullable().optional(),
})

export type AdvanceStageInput = z.infer<typeof advanceStageSchema>

// ============================================================
// Procurement Activity labels
// ============================================================

export const PROCUREMENT_METHOD_LABELS: Record<string, string> = {
  svp:                  "Small Value Procurement",
  shopping:             "Shopping",
  competitive_bidding:  "Competitive Bidding",
  direct_contracting:   "Direct Contracting",
  repeat_order:         "Repeat Order",
  emergency:            "Emergency Purchase",
  negotiated:           "Negotiated Procurement",
  agency_to_agency:     "Agency-to-Agency",
}

export const PROCUREMENT_STATUS_LABELS: Record<string, string> = {
  active:    "Active",
  completed: "Completed",
  failed:    "Failed",
  cancelled: "Cancelled",
}

export const BID_STATUS_LABELS: Record<string, string> = {
  submitted:     "Submitted",
  evaluated:     "Evaluated",
  awarded:       "Awarded",
  disqualified:  "Disqualified",
}

export const SVP_STAGE_LABELS: Record<string, string> = {
  created:              "Created",
  rfq_preparation:      "RFQ Preparation",
  rfq_sent:             "RFQ Sent",
  quotations_received:  "Quotations Received",
  evaluation:           "Evaluation",
  abstract_prepared:    "Abstract Prepared",
  award_recommended:    "Award Recommended",
  award_approved:       "Award Approved",
  completed:            "Completed",
}

export const SHOPPING_STAGE_LABELS: Record<string, string> = {
  created:              "Created",
  canvass_preparation:  "Canvass Preparation",
  canvass_sent:         "Canvass Sent",
  canvass_received:     "Canvass Received",
  comparison:           "Price Comparison",
  award_recommended:    "Award Recommended",
  award_approved:       "Award Approved",
  completed:            "Completed",
}
