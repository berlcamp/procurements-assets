import { cn } from "@/lib/utils"
import { CheckCircle2, XCircle, RotateCcw, ArrowRight, Info, Clock } from "lucide-react"
import { ApprovalAction } from "@/types/database"

export interface TimelineEntry {
  id: string
  step_name: string
  step_order: number
  action: ApprovalAction
  actor_name: string
  actor_position?: string
  acted_at: string
  remarks?: string | null
}

interface TimelineLogProps {
  entries: TimelineEntry[]
  emptyMessage?: string
  className?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_CONFIG: Record<ApprovalAction, {
  icon: React.ElementType
  iconClass: string
  connectorClass: string
  label: string
}> = {
  approved: {
    icon: CheckCircle2,
    iconClass: "text-green-600 bg-green-50 border-green-200",
    connectorClass: "bg-green-200",
    label: "Approved",
  },
  rejected: {
    icon: XCircle,
    iconClass: "text-red-600 bg-red-50 border-red-200",
    connectorClass: "bg-red-200",
    label: "Rejected",
  },
  returned: {
    icon: RotateCcw,
    iconClass: "text-orange-600 bg-orange-50 border-orange-200",
    connectorClass: "bg-orange-200",
    label: "Returned",
  },
  forwarded: {
    icon: ArrowRight,
    iconClass: "text-blue-600 bg-blue-50 border-blue-200",
    connectorClass: "bg-blue-200",
    label: "Forwarded",
  },
  noted: {
    icon: Info,
    iconClass: "text-gray-600 bg-gray-50 border-gray-200",
    connectorClass: "bg-gray-200",
    label: "Noted",
  },
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TimelineLog({ entries, emptyMessage = "No activity yet.", className }: TimelineLogProps) {
  if (entries.length === 0) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground py-4", className)}>
        <Clock className="h-4 w-4" />
        {emptyMessage}
      </div>
    )
  }

  const sorted = [...entries].sort((a, b) => a.step_order - b.step_order)

  return (
    <div className={cn("flex flex-col", className)}>
      {sorted.map((entry, i) => {
        const config = ACTION_CONFIG[entry.action] ?? ACTION_CONFIG.noted
        const Icon = config.icon
        const isLast = i === sorted.length - 1

        return (
          <div key={entry.id} className="flex gap-3">
            {/* Icon + connector */}
            <div className="flex flex-col items-center">
              <div className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border shrink-0",
                config.iconClass,
              )}>
                <Icon className="h-4 w-4" />
              </div>
              {!isLast && (
                <div className={cn("w-0.5 flex-1 min-h-4 mt-1", config.connectorClass)} />
              )}
            </div>

            {/* Content */}
            <div className={cn("flex-1", !isLast && "pb-5")}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{entry.step_name}</p>
                <span className="text-xs text-muted-foreground shrink-0">{formatDateTime(entry.acted_at)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className={cn(
                  "font-medium",
                  entry.action === "approved" && "text-green-700",
                  entry.action === "rejected" && "text-red-700",
                  entry.action === "returned" && "text-orange-700",
                  entry.action === "forwarded" && "text-blue-700",
                )}>
                  {config.label}
                </span>
                {" by "}
                {entry.actor_name}
                {entry.actor_position && (
                  <span className="text-muted-foreground"> ({entry.actor_position})</span>
                )}
              </p>
              {entry.remarks && (
                <p className="mt-1 text-xs text-muted-foreground italic">"{entry.remarks}"</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
