import { notFound } from "next/navigation"
import Link from "next/link"
import {
  getBudgetAllocationById,
  getBudgetAdjustments,
} from "@/lib/actions/budget"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AmountDisplay } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import { FundAvailabilityBadge } from "@/components/budget/fund-availability-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { ADJUSTMENT_TYPE_LABELS } from "@/lib/schemas/budget"
import { PlusIcon } from "lucide-react"
import type { BudgetAdjustmentWithDetails } from "@/types/database"

interface Props {
  params: Promise<{ id: string }>
}

export default async function AllocationDetailPage({ params }: Props) {
  const { id } = await params
  const allocation = await getBudgetAllocationById(id)
  if (!allocation) notFound()

  const adjustments = await getBudgetAdjustments(undefined, undefined)
  const relatedAdjustments = adjustments.filter(
    (adj) => adj.budget_allocation_id === id
  )

  const office = allocation.office as { name: string; code: string } | undefined
  const fs = allocation.fund_source as { name: string; code: string } | undefined
  const ac = allocation.account_code as { code: string; name: string; expense_class: string } | undefined
  const fy = allocation.fiscal_year as { year: number; status: string } | undefined

  const available = parseFloat(allocation.adjusted_amount) - parseFloat(allocation.obligated_amount)
  const utilizationPct =
    parseFloat(allocation.adjusted_amount) > 0
      ? (parseFloat(allocation.obligated_amount) / parseFloat(allocation.adjusted_amount)) * 100
      : 0

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Budget Allocation</h1>
          <p className="text-muted-foreground text-sm">
            {office?.name} — FY {fy?.year}
          </p>
        </div>
        <Link href="/dashboard/budget/allocations">
          <Button variant="outline" size="sm">Back to list</Button>
        </Link>
      </div>

      {/* Detail card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Allocation Details</CardTitle>
            <StatusBadge status={allocation.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Office</p>
              <p className="font-medium">{office?.name} ({office?.code})</p>
            </div>
            <div>
              <p className="text-muted-foreground">Fiscal Year</p>
              <p className="font-medium flex items-center gap-2">
                {fy?.year}
                {fy && <StatusBadge status={fy.status} className="text-xs" />}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Fund Source</p>
              <p className="font-medium">{fs?.name} ({fs?.code})</p>
            </div>
            <div>
              <p className="text-muted-foreground">Account Code (UACS)</p>
              <p className="font-mono font-medium">{ac?.code}</p>
              <p className="text-xs text-muted-foreground">{ac?.name} — {ac?.expense_class}</p>
            </div>
          </div>

          {allocation.description && (
            <div>
              <p className="text-muted-foreground text-sm">Description</p>
              <p className="text-sm">{allocation.description}</p>
            </div>
          )}

          <Separator />

          {/* Budget balances */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Original</p>
              <AmountDisplay amount={allocation.original_amount} className="text-lg font-bold" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Adjusted</p>
              <AmountDisplay amount={allocation.adjusted_amount} className="text-lg font-bold" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Obligated</p>
              <AmountDisplay amount={allocation.obligated_amount} className="text-lg font-bold" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Disbursed</p>
              <AmountDisplay amount={allocation.disbursed_amount} className="text-lg font-bold" />
            </div>
          </div>

          {/* Utilization bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Utilization</span>
              <FundAvailabilityBadge availableAmount={available} adjustedAmount={allocation.adjusted_amount} />
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  utilizationPct > 90
                    ? "bg-red-500"
                    : utilizationPct > 70
                    ? "bg-yellow-500"
                    : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(utilizationPct, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{utilizationPct.toFixed(1)}% obligated</p>
          </div>
        </CardContent>
      </Card>

      {/* Adjustment history */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Adjustment History</CardTitle>
              <CardDescription>Budget adjustments applied to this allocation</CardDescription>
            </div>
            <Link href="/dashboard/budget/adjustments/new">
              <Button size="sm" variant="outline">
                <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
                Request Adjustment
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {relatedAdjustments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No adjustments yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {relatedAdjustments.map((adj: BudgetAdjustmentWithDetails) => (
                  <TableRow key={adj.id}>
                    <TableCell>{ADJUSTMENT_TYPE_LABELS[adj.adjustment_type] ?? adj.adjustment_type}</TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={adj.amount} showSign />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={adj.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
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
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
