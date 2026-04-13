import Link from "next/link"
import { ArrowRight, Building2, Clock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { ApprovalItem, ApprovalModule } from "@/lib/actions/approvals"

const MODULE_CONFIG: Record<ApprovalModule, { label: string; className: string }> = {
  ppmp: { label: "PPMP", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  app: { label: "APP", className: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  pr: { label: "PR", className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  procurement: { label: "Procurement", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

export function ApprovalCard({ item }: { item: ApprovalItem }) {
  const config = MODULE_CONFIG[item.module]

  return (
    <Link
      href={item.href}
      className="group flex items-center gap-4 rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${config.className}`}>
            {config.label}
          </span>
          <span className="truncate text-sm font-medium">{item.title}</span>
        </div>
        <p className="text-xs text-muted-foreground">{item.description}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {item.office && (
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {item.office}
            </span>
          )}
          {item.requester && (
            <span>by {item.requester}</span>
          )}
          {item.amount != null && item.amount > 0 && (
            <span className="font-medium text-foreground">
              ₱{item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {relativeTime(item.updatedAt)}
          </span>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}
