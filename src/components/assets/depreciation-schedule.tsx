"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { DepreciationRecord } from "@/types/database"

interface DepreciationScheduleProps {
  records: DepreciationRecord[]
  acquisitionCost: number
  residualValue: number
  usefulLifeYears: number | null
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function DepreciationSchedule({
  records,
  acquisitionCost,
  residualValue,
  usefulLifeYears,
}: DepreciationScheduleProps) {
  // Build projected schedule if useful life is set
  const projected: Array<{
    year: number
    month: number
    amount: number
    accumulated: number
    bookValue: number
    isActual: boolean
  }> = []

  // Add actual records
  for (const r of records) {
    projected.push({
      year: r.period_year,
      month: r.period_month,
      amount: parseFloat(r.depreciation_amount),
      accumulated: parseFloat(r.accumulated_amount),
      bookValue: parseFloat(r.book_value),
      isActual: true,
    })
  }

  // Calculate future projected depreciation
  if (usefulLifeYears && usefulLifeYears > 0) {
    const monthlyDep = Math.round(((acquisitionCost - residualValue) / (usefulLifeYears * 12)) * 100) / 100
    const totalMonths = usefulLifeYears * 12

    // Find the last actual or start from acquisition
    let lastAccum = records.length > 0
      ? parseFloat(records[records.length - 1].accumulated_amount)
      : 0
    let lastYear = records.length > 0
      ? records[records.length - 1].period_year
      : new Date().getFullYear()
    let lastMonth = records.length > 0
      ? records[records.length - 1].period_month
      : new Date().getMonth() + 1 // getMonth() is 0-indexed, DB uses 1-12

    const currentBookValue = acquisitionCost - lastAccum
    if (currentBookValue > residualValue && projected.length < totalMonths) {
      // Project remaining months
      const remainingMonths = totalMonths - projected.length
      for (let i = 0; i < remainingMonths; i++) {
        lastMonth += 1
        if (lastMonth > 12) {
          lastMonth = 1
          lastYear += 1
        }

        const dep = Math.min(monthlyDep, acquisitionCost - lastAccum - residualValue)
        if (dep <= 0) break

        lastAccum += dep
        const bv = acquisitionCost - lastAccum

        projected.push({
          year: lastYear,
          month: lastMonth,
          amount: dep,
          accumulated: lastAccum,
          bookValue: bv,
          isActual: false,
        })
      }
    }
  }

  if (projected.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        No depreciation records. {usefulLifeYears ? "Run monthly depreciation to generate records." : "Set useful life years to enable depreciation."}
      </p>
    )
  }

  return (
    <div className="max-h-[400px] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Depreciation</TableHead>
            <TableHead className="text-right">Accumulated</TableHead>
            <TableHead className="text-right">Book Value</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {projected.map((row, idx) => (
            <TableRow key={idx} className={row.isActual ? "" : "text-muted-foreground"}>
              <TableCell className="text-sm">
                {MONTH_NAMES[row.month]} {row.year}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatCurrency(row.amount)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatCurrency(row.accumulated)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatCurrency(row.bookValue)}
              </TableCell>
              <TableCell className="text-xs">
                {row.isActual ? "" : "projected"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
