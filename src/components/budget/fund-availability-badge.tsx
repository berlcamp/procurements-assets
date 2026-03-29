import { cn } from "@/lib/utils"
import { formatPeso } from "@/components/shared/amount-display"

interface FundAvailabilityBadgeProps {
  availableAmount: string | number
  adjustedAmount?: string | number
  className?: string
}

export function FundAvailabilityBadge({
  availableAmount,
  adjustedAmount,
  className,
}: FundAvailabilityBadgeProps) {
  const available = typeof availableAmount === "string" ? parseFloat(availableAmount) : availableAmount
  const adjusted = adjustedAmount != null
    ? (typeof adjustedAmount === "string" ? parseFloat(adjustedAmount) : adjustedAmount)
    : null

  const pct = adjusted && adjusted > 0 ? (available / adjusted) * 100 : null

  const colorClass =
    pct === null
      ? "bg-gray-100 text-gray-700 border-gray-200"
      : pct > 50
      ? "bg-green-100 text-green-800 border-green-200"
      : pct > 20
      ? "bg-yellow-100 text-yellow-800 border-yellow-200"
      : "bg-red-100 text-red-800 border-red-200"

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium font-mono tabular-nums",
        colorClass,
        className
      )}
    >
      {formatPeso(available)} available
    </span>
  )
}
