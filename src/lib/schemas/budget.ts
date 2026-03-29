import { z } from "zod"

// ============================================================
// Budget Allocation
// ============================================================

export const budgetAllocationSchema = z.object({
  fiscal_year_id: z.string().uuid("Fiscal year is required"),
  office_id: z.string().uuid("Office is required"),
  fund_source_id: z.string().uuid("Fund source is required"),
  account_code_id: z.string().uuid("Account code is required"),
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
