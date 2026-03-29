import Link from "next/link"
import { getActiveFiscalYear, getBudgetAdjustments } from "@/lib/actions/budget"
import { Button } from "@/components/ui/button"
import { AmountDisplay } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ADJUSTMENT_TYPE_LABELS } from "@/lib/schemas/budget"
import { PlusIcon } from "lucide-react"
import type { BudgetAdjustmentWithDetails, BudgetAllocationWithDetails } from "@/types/database"

export default async function AdjustmentsPage() {
  const [fiscalYear, adjustments] = await Promise.all([
    getActiveFiscalYear(),
    getBudgetAdjustments(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Budget Adjustments</h1>
          <p className="text-muted-foreground text-sm">
            Realignments, augmentations, reductions, and transfers
          </p>
        </div>
        <Link href="/dashboard/budget/adjustments/new">
          <Button>
            <PlusIcon className="mr-1.5 h-4 w-4" />
            New Adjustment
          </Button>
        </Link>
      </div>

      {adjustments.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm">No adjustments yet.</p>
          <Link href="/dashboard/budget/adjustments/new" className="mt-3 block">
            <Button variant="outline" size="sm">
              Submit an adjustment request
            </Button>
          </Link>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Allocation</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.map((adj: BudgetAdjustmentWithDetails) => {
                const alloc = adj.budget_allocation as BudgetAllocationWithDetails | undefined
                const allocOffice = alloc?.office as { name: string } | undefined
                const allocAC = alloc?.account_code as { code: string } | undefined
                const allocFY = alloc?.fiscal_year as { year: number } | undefined

                return (
                  <TableRow key={adj.id}>
                    <TableCell className="font-medium">
                      {ADJUSTMENT_TYPE_LABELS[adj.adjustment_type] ?? adj.adjustment_type}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="font-medium">{allocOffice?.name ?? "—"}</span>
                      {allocAC && (
                        <span className="ml-1 font-mono text-xs text-muted-foreground">
                          {allocAC.code}
                        </span>
                      )}
                      {allocFY && (
                        <span className="ml-1 text-xs text-muted-foreground">FY{allocFY.year}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={adj.amount} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={adj.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {adj.reference_number ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(adj.created_at).toLocaleDateString("en-PH")}
                    </TableCell>
                    <TableCell>
                      <Link href={`/dashboard/budget/adjustments/${adj.id}`}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
