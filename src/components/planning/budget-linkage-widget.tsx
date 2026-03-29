"use client"

import { useEffect, useState } from "react"
import { getBudgetAllocationsByOffice } from "@/lib/actions/budget"
import { AmountDisplay } from "@/components/shared/amount-display"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { BudgetAllocationWithDetails } from "@/types/database"

interface BudgetLinkageWidgetProps {
  officeId: string
  fiscalYearId: string
  /** Currently consumed amounts by budget_allocation_id from PPMP items in this version */
  ppmpUsageByAllocation: Record<string, number>
  className?: string
}

export function BudgetLinkageWidget({
  officeId,
  fiscalYearId,
  ppmpUsageByAllocation,
  className,
}: BudgetLinkageWidgetProps) {
  const [allocations, setAllocations] = useState<BudgetAllocationWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getBudgetAllocationsByOffice(officeId, fiscalYearId).then((data) => {
      if (!cancelled) {
        setAllocations(data)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [officeId, fiscalYearId])

  if (loading) {
    return (
      <div className={cn("rounded-md border p-4", className)}>
        <p className="text-sm text-muted-foreground animate-pulse">Loading budget data...</p>
      </div>
    )
  }

  if (allocations.length === 0) {
    return (
      <div className={cn("rounded-md border p-4", className)}>
        <p className="text-sm text-muted-foreground">No budget allocations found for this office and fiscal year.</p>
      </div>
    )
  }

  return (
    <div className={cn("rounded-md border", className)}>
      <div className="border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">Budget Availability</h3>
        <p className="text-xs text-muted-foreground">Real-time view of budget lines for this office</p>
      </div>
      <div className="divide-y">
        {allocations.map((alloc) => {
          const adjusted = parseFloat(alloc.adjusted_amount)
          const obligated = parseFloat(alloc.obligated_amount)
          const systemAvailable = adjusted - obligated
          const ppmpUsage = ppmpUsageByAllocation[alloc.id] ?? 0
          const remainingAfterPpmp = systemAvailable - ppmpUsage
          const overBudget = remainingAfterPpmp < 0
          const utilizationPct = adjusted > 0 ? ((obligated + ppmpUsage) / adjusted) * 100 : 0

          return (
            <div key={alloc.id} className="px-4 py-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {alloc.account_code?.code} — {alloc.account_code?.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {alloc.fund_source?.name}
                    {alloc.account_code?.expense_class && (
                      <span className="ml-1">({alloc.account_code.expense_class})</span>
                    )}
                  </p>
                </div>
                {overBudget && (
                  <Badge variant="destructive" className="text-xs shrink-0">Over Budget</Badge>
                )}
              </div>

              {/* Progress bar */}
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    overBudget ? "bg-red-500" : utilizationPct > 80 ? "bg-amber-500" : "bg-green-500"
                  )}
                  style={{ width: `${Math.min(utilizationPct, 100)}%` }}
                />
              </div>

              {/* Numbers */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Budget</span>
                  <AmountDisplay amount={adjusted} className="block text-xs" />
                </div>
                <div>
                  <span className="text-muted-foreground">This PPMP</span>
                  <AmountDisplay amount={ppmpUsage} className={cn("block text-xs", ppmpUsage > 0 && "text-blue-600")} />
                </div>
                <div>
                  <span className="text-muted-foreground">Remaining</span>
                  <AmountDisplay
                    amount={remainingAfterPpmp}
                    className={cn("block text-xs font-semibold", overBudget && "text-destructive")}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
