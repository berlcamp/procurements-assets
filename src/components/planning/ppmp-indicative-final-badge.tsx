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
  const stage = value ?? "indicative"
  return <Badge variant={VARIANTS[stage]}>{LABELS[stage]}</Badge>
}

/** @deprecated Use PlanningStageBadge. Kept so existing imports compile. */
export const PpmpIndicativeFinalBadge = PlanningStageBadge
