"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { ApprovalCard } from "@/components/approvals/approval-card"
import type { ApprovalItem, ApprovalModule } from "@/lib/actions/approvals"

type FilterTab = "all" | ApprovalModule

const TABS: { label: string; value: FilterTab }[] = [
  { label: "All", value: "all" },
  { label: "PPMP", value: "ppmp" },
  { label: "APP", value: "app" },
  { label: "Purchase Requests", value: "pr" },
  { label: "Procurement", value: "procurement" },
]

export function ApprovalInboxClient({ items }: { items: ApprovalItem[] }) {
  const [tab, setTab] = useState<FilterTab>("all")

  const filtered = tab === "all" ? items : items.filter((i) => i.module === tab)

  // Count per module for tab badges
  const counts: Record<FilterTab, number> = {
    all: items.length,
    ppmp: items.filter((i) => i.module === "ppmp").length,
    app: items.filter((i) => i.module === "app").length,
    pr: items.filter((i) => i.module === "pr").length,
    procurement: items.filter((i) => i.module === "procurement").length,
  }

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {t.label}
            {counts[t.value] > 0 && (
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold",
                  tab === t.value
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted-foreground/10 text-muted-foreground"
                )}
              >
                {counts[t.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Items list */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          {tab === "all"
            ? "No pending approvals — you're all caught up!"
            : `No pending ${TABS.find((t) => t.value === tab)?.label ?? ""} items`}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <ApprovalCard key={`${item.module}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
