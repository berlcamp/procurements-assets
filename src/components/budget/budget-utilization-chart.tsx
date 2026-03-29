"use client"

import { formatPeso } from "@/components/shared/amount-display"
import type { BudgetUtilizationByOffice } from "@/types/database"

interface BudgetUtilizationChartProps {
  data: BudgetUtilizationByOffice[]
}

export function BudgetUtilizationChart({ data }: BudgetUtilizationChartProps) {
  if (!data.length) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No budget data for this fiscal year.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {data.map((row) => {
        const pct = parseFloat(row.utilization_pct)
        const barColor =
          pct > 90
            ? "bg-red-500"
            : pct > 70
            ? "bg-yellow-500"
            : "bg-emerald-500"

        return (
          <div key={row.office_id} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium truncate max-w-[60%]" title={row.office_name}>
                {row.office_name}
              </span>
              <span className="text-muted-foreground font-mono tabular-nums text-xs">
                {formatPeso(row.total_obligated)} / {formatPeso(row.total_adjusted)}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {pct.toFixed(1)}% obligated &mdash; {formatPeso(row.total_available)} available
            </p>
          </div>
        )
      })}
    </div>
  )
}
