import { z } from "zod"

// ============================================================
// HOPE Review
// ============================================================

export const appHopeReviewSchema = z.object({
  action: z.enum(['approve', 'remark']),
  remarks: z.string().nullable().optional(),
}).refine(
  (data) => data.action !== 'remark' || (data.remarks && data.remarks.trim().length >= 5),
  { message: "Remarks are required when remarking (min 5 characters)", path: ['remarks'] }
)

export type AppHopeReviewInput = z.infer<typeof appHopeReviewSchema>

// ============================================================
// BAC Lot
// ============================================================

export const appLotSchema = z.object({
  lot_name: z.string().min(3, "Lot name must be at least 3 characters"),
  description: z.string().nullable().optional(),
  procurement_method: z.enum([
    'competitive_bidding', 'limited_source_bidding', 'direct_contracting',
    'repeat_order', 'shopping', 'svp', 'negotiated', 'agency_to_agency', 'emergency',
  ], { message: "Procurement method is required" }),
})

export type AppLotInput = z.infer<typeof appLotSchema>

// ============================================================
// APP Approval
// ============================================================

export const appApproveSchema = z.object({
  notes: z.string().nullable().optional(),
})

export type AppApproveInput = z.infer<typeof appApproveSchema>

// ============================================================
// Labels
// ============================================================

export const APP_STATUS_LABELS: Record<string, string> = {
  populating:        "Populating",
  indicative:        "Indicative",
  under_review:      "Under Review",
  bac_finalization:  "BAC Finalization",
  final:             "Final",
  approved:          "Approved",
  posted:            "Posted",
}

export const HOPE_REVIEW_STATUS_LABELS: Record<string, string> = {
  pending:  "Pending",
  approved: "Approved",
  remarked: "Remarked",
}

export const APP_LOT_STATUS_LABELS: Record<string, string> = {
  draft:           "Draft",
  finalized:       "Finalized",
  in_procurement:  "In Procurement",
}
