import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface StatusBadgeProps {
  status: string
  className?: string
}

function getStatusClassName(status: string): string {
  switch (status.toLowerCase()) {
    case "active":
    case "success":
      return "bg-green-100 text-green-800 border-green-200"
    case "trial":
      return "bg-blue-100 text-blue-800 border-blue-200"
    case "pending":
      return "bg-yellow-100 text-yellow-800 border-yellow-200"
    case "suspended":
    case "expired":
    case "error":
      return "bg-red-100 text-red-800 border-red-200"
    case "critical":
      return "bg-red-100 text-red-800 border-red-200"
    case "warning":
    case "maintenance":
      return "bg-orange-100 text-orange-800 border-orange-200"
    case "info":
    default:
      return "bg-gray-100 text-gray-700 border-gray-200"
  }
}

function formatStatusLabel(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(getStatusClassName(status), className)}
    >
      {formatStatusLabel(status)}
    </Badge>
  )
}
