import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface StatusBadgeProps {
  status: string
  className?: string
}

function getStatusClassName(status: string): string {
  switch (status.toLowerCase()) {
    // Success / Final states
    case "active":
    case "success":
    case "approved":
    case "completed":
    case "delivered":
    case "final":
      return "bg-green-100 text-green-800 border-green-200"

    // In-progress / informational
    case "trial":
    case "in_progress":
    case "in_procurement":
    case "under_review":
    case "forwarded":
    case "bac_finalization":
    case "populating":
      return "bg-blue-100 text-blue-800 border-blue-200"

    // Pending / awaiting action
    case "pending":
    case "draft":
    case "submitted":
    case "for_approval":
    case "noted":
    case "chief_reviewed":
    case "budget_certified":
      return "bg-yellow-100 text-yellow-800 border-yellow-200"

    // Rejected / failed / stopped
    case "suspended":
    case "expired":
    case "error":
    case "critical":
    case "rejected":
    case "cancelled":
    case "failed":
    case "overdue":
      return "bg-red-100 text-red-800 border-red-200"

    // Returned / needs revision
    case "returned":
    case "revision_required":
    case "warning":
    case "maintenance":
    case "partially_delivered":
      return "bg-orange-100 text-orange-800 border-orange-200"

    // Locked / archived / inactive
    case "locked":
    case "archived":
    case "inactive":
    case "info":
      return "bg-gray-100 text-gray-700 border-gray-200"

    // Special procurement phases
    case "indicative":
      return "bg-violet-100 text-violet-800 border-violet-200"
    case "posted":
      return "bg-emerald-100 text-emerald-800 border-emerald-200"

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
