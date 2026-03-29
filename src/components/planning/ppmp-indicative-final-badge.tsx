import { Badge } from "@/components/ui/badge"

interface PpmpIndicativeFinalBadgeProps {
  value: "indicative" | "final"
}

export function PpmpIndicativeFinalBadge({ value }: PpmpIndicativeFinalBadgeProps) {
  return (
    <Badge variant={value === "final" ? "default" : "outline"}>
      {value === "final" ? "FINAL" : "INDICATIVE"}
    </Badge>
  )
}
