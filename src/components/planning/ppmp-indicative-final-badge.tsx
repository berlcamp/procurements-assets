import { Badge } from "@/components/ui/badge"
import type { PlanningStage } from "@/types/database"

interface PlanningStageBadgeProps {
  value: PlanningStage | null
}

const LABELS: Record<PlanningStage, string> = {
  indicative: "INDICATIVE",
  final: "FINAL",
  supplemental: "SUPPLEMENTAL",
}

const VARIANTS: Record<PlanningStage, "default" | "outline" | "secondary"> = {
  indicative: "outline",
  final: "default",
  supplemental: "secondary",
}

export function PlanningStageBadge({ value }: PlanningStageBadgeProps) {
  // A NULL stage means "not determined" — most often because no budget ceiling
  // was in force when the version was created, which the date-aware backfill in
  // 20260802 deliberately leaves NULL rather than guessing.
  //
  // This used to read `value ?? "indicative"`, which rendered unknown as a
  // confident INDICATIVE on every detail and version screen. That is the exact
  // failure this refactor exists to remove — indicative_final was inverted, and
  // defaulting to one of its two values re-creates a wrong answer that looks
  // authoritative. Render the absence instead.
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>
  }
  return <Badge variant={VARIANTS[value]}>{LABELS[value]}</Badge>
}

/** @deprecated Use PlanningStageBadge. Kept so existing imports compile. */
export const PpmpIndicativeFinalBadge = PlanningStageBadge
