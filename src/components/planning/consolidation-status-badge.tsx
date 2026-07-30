import { Badge } from "@/components/ui/badge"
import type { ConsolidationStatus } from "@/types/database"

interface ConsolidationStatusBadgeProps {
  status: ConsolidationStatus | null | undefined
}

const LABELS: Record<ConsolidationStatus, string> = {
  pending: "PENDING",
  consolidated: "IN APP",
  failed: "NOT IN APP",
  not_applicable: "N/A",
}

const VARIANTS: Record<
  ConsolidationStatus,
  "default" | "outline" | "secondary" | "destructive"
> = {
  pending: "outline",
  consolidated: "secondary",
  failed: "destructive",
  not_applicable: "outline",
}

/**
 * Renders procurements.ppmps.consolidation_status — whether an approved PPMP's
 * items actually reached the APP.
 *
 * `failed` is the one that matters: the office believes its plan is in the APP
 * and it is not. Callers on list screens should render this badge only for
 * `failed`; showing "PENDING" beside every draft is noise. The detail screen
 * shows every state, because there the user asked about that one PPMP.
 *
 * An unknown or absent status renders as an em-dash rather than falling back to
 * any of the four known values. Defaulting an unknown state to a confident label
 * is the exact defect fixed in cffa6b8 for PlanningStageBadge: the column is
 * governed by a CHECK constraint that a later migration may extend, and a value
 * this component has not learned must read as unknown, not as a guess.
 */
export function ConsolidationStatusBadge({
  status,
}: ConsolidationStatusBadgeProps) {
  if (status == null || !(status in LABELS)) {
    return <span className="text-muted-foreground">—</span>
  }
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>
}
