import "./zod-config"
import { z } from "zod"

// ============================================================
// Budget Allocation
// ============================================================

export const budgetAllocationSchema = z.object({
  fiscal_year_id: z.string().uuid("Fiscal year is required"),
  office_id: z.string().uuid("Office is required"),
  fund_source_id: z.string().uuid("Fund source is required"),
  account_code_id: z.string().uuid("Account code is required"),
  sub_aro_id: z.string().uuid().nullable().optional(),
  saro_id: z.string().uuid().nullable().optional(),
  original_amount: z
    .string()
    .min(1, "Amount is required")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
      message: "Amount must be a non-negative number",
    }),
  description: z.string().nullable().optional(),
})

export type BudgetAllocationInput = z.infer<typeof budgetAllocationSchema>

// ============================================================
// Budget Ceiling
// ============================================================

export const budgetCeilingSchema = z.object({
  fiscal_year_id: z.string().uuid("Select a fiscal year"),
  stage: z.enum(["indicative", "nep", "gaa", "final", "supplemental"]),
  tier: z.enum(["tier_1", "tier_2"]).nullable().optional(),
  issuing_authority: z.string().min(2, "Issuing authority is required"),
  reference_number: z.string().trim().min(1).nullable().optional(),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
      message: "Amount must be a non-negative number",
    }),
  issued_date: z.string().nullable().optional(),
  effective_date: z.string().nullable().optional(),
  is_authoritative: z.boolean().default(true),
  document_url: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
})

export type BudgetCeilingInput = z.infer<typeof budgetCeilingSchema>

// Vocabulary comes verbatim from the CHECK constraint and COMMENT ON COLUMN in
// supabase/migrations/20260801_budget_ceilings.sql. Do not invent new stages —
// procurements.ceiling_stage_to_planning_stage() only maps these five.
export const CEILING_STAGE_LABELS: Record<string, string> = {
  indicative:   "Indicative",
  nep:          "NEP",
  gaa:          "GAA",
  final:        "Final Release",
  supplemental: "Supplemental",
}

// The DBM → DepEd CO → RO → SDO chain, in escalating order of legal force.
// `supplemental` sits outside the chain: it never changes the FY's base stage.
export const CEILING_STAGE_ORDER = [
  "indicative",
  "nep",
  "gaa",
  "final",
] as const

export const CEILING_STAGE_DESCRIPTIONS: Record<string, string> = {
  indicative:   "Regional Office indicative ceiling — no appropriation yet.",
  nep:          "National Expenditure Program submitted to Congress — no appropriation yet.",
  gaa:          "General Appropriations Act enacted — appropriation exists.",
  final:        "Comprehensive release / Sub-ARO — appropriation exists and is released.",
  supplemental: "SARO or additional release for a special purpose.",
}

// Legal basis, per the COMMENT ON COLUMN budget_ceilings.stage.
export const CEILING_STAGE_LEGAL_BASIS: Record<string, string> = {
  indicative:   "No appropriation yet",
  nep:          "No appropriation yet",
  gaa:          "Enacted",
  final:        "Enacted",
  supplemental: "Additional release",
}

// DBM two-tier budgeting.
export const CEILING_TIER_LABELS: Record<string, string> = {
  tier_1: "Tier 1 — Ongoing programs",
  tier_2: "Tier 2 — New / expanded programs",
}

export const PLANNING_STAGE_LABELS: Record<string, string> = {
  indicative:   "Indicative",
  final:        "Final",
  supplemental: "Supplemental",
}

// ============================================================
// Budget Adjustment
// ============================================================

export const budgetAdjustmentSchema = z.object({
  budget_allocation_id: z.string().uuid("Budget allocation is required"),
  adjustment_type: z.enum(
    ["realignment", "augmentation", "reduction", "transfer_in", "transfer_out"],
    { error: "Adjustment type is required" }
  ),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, {
      message: "Amount must be greater than zero",
    }),
  justification: z.string().min(10, "Justification must be at least 10 characters"),
  reference_number: z.string().nullable().optional(),
})

export type BudgetAdjustmentInput = z.infer<typeof budgetAdjustmentSchema>

// ============================================================
// Adjustment approval (remarks)
// ============================================================

export const adjustmentRemarkSchema = z.object({
  remarks: z.string().nullable().optional(),
})

export type AdjustmentRemarkInput = z.infer<typeof adjustmentRemarkSchema>

// ============================================================
// Labels
// ============================================================

export const ADJUSTMENT_TYPE_LABELS: Record<string, string> = {
  realignment:  "Realignment",
  augmentation: "Augmentation",
  reduction:    "Reduction",
  transfer_in:  "Transfer In",
  transfer_out: "Transfer Out",
}

export const ADJUSTMENT_STATUS_LABELS: Record<string, string> = {
  pending:   "Pending",
  approved:  "Approved",
  rejected:  "Rejected",
  cancelled: "Cancelled",
}

// ============================================================
// Sub-ARO schemas
// ============================================================

export const subAroSchema = z.object({
  fiscal_year_id: z.string().uuid("Fiscal year is required"),
  sub_aro_number: z.string().min(1, "Sub-ARO number is required"),
  aro_number: z.string().nullable().optional(),
  allotment_class: z.enum(["current", "continuing"], {
    error: "Allotment class is required",
  }),
  fund_source_id: z.string().uuid("Fund source is required"),
  releasing_office: z.string().nullable().optional(),
  release_date: z.string().nullable().optional(),
  validity_date: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  total_amount: z
    .string()
    .min(1, "Total amount is required")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
      message: "Amount must be a non-negative number",
    }),
  remarks: z.string().nullable().optional(),
})
export type SubAroInput = z.infer<typeof subAroSchema>

export const SUB_ARO_STATUS_LABELS: Record<string, string> = {
  draft:           "Draft",
  active:          "Active",
  fully_allocated: "Fully Allocated",
  expired:         "Expired",
  cancelled:       "Cancelled",
}

export const ALLOTMENT_CLASS_LABELS: Record<string, string> = {
  current:    "Current",
  continuing: "Continuing",
}

// ============================================================
// SARO schemas
// ============================================================

export const saroSchema = z.object({
  fiscal_year_id: z.string().uuid("Fiscal year is required"),
  saro_number: z.string().min(1, "SARO number is required"),
  reference_number: z.string().nullable().optional(),
  program: z.string().nullable().optional(),
  allotment_class: z.enum(["current", "continuing"], {
    error: "Allotment class is required",
  }),
  fund_source_id: z.string().uuid("Fund source is required"),
  releasing_office: z.string().nullable().optional(),
  release_date: z.string().nullable().optional(),
  validity_date: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  total_amount: z
    .string()
    .min(1, "Total amount is required")
    .refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, {
      message: "Amount must be a non-negative number",
    }),
  remarks: z.string().nullable().optional(),
})
export type SaroInput = z.infer<typeof saroSchema>

export const SARO_STATUS_LABELS: Record<string, string> = {
  draft:           "Draft",
  active:          "Active",
  fully_allocated: "Fully Allocated",
  expired:         "Expired",
  cancelled:       "Cancelled",
}
