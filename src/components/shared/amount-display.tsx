import { cn } from "@/lib/utils"

interface AmountDisplayProps {
  amount: string | number
  className?: string
  showSign?: boolean
  compact?: boolean
}

function formatPeso(
  amount: string | number,
  compact = false
): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount
  if (isNaN(num)) return "₱0.00"
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    notation: compact ? "compact" : "standard",
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 1 : 2,
  }).format(num)
}

export function AmountDisplay({ amount, className, showSign, compact }: AmountDisplayProps) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount
  const isNegative = !isNaN(num) && num < 0

  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        isNegative && "text-destructive",
        className
      )}
    >
      {showSign && num > 0 ? "+" : ""}
      {formatPeso(amount, compact)}
    </span>
  )
}

export { formatPeso }
