import { notFound } from "next/navigation"
import Link from "next/link"
import { getBudgetAdjustmentById, approveBudgetAdjustment, rejectBudgetAdjustment } from "@/lib/actions/budget"
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
import { ApprovalActions } from "@/components/shared/approval-actions"
import { Separator } from "@/components/ui/separator"
import { ADJUSTMENT_TYPE_LABELS } from "@/lib/schemas/budget"
import type { BudgetAllocationWithDetails } from "@/types/database"

interface Props {
  params: Promise<{ id: string }>
}

export default async function AdjustmentDetailPage({ params }: Props) {
  const { id } = await params
  const adjustment = await getBudgetAdjustmentById(id)
  if (!adjustment) notFound()

  const alloc = adjustment.budget_allocation as BudgetAllocationWithDetails | undefined
  const allocOffice = alloc?.office as { name: string; code: string } | undefined
  const allocFS = alloc?.fund_source as { name: string; code: string } | undefined
  const allocAC = alloc?.account_code as { code: string; name: string; expense_class: string } | undefined
  const allocFY = alloc?.fiscal_year as { year: number; status: string } | undefined
  const office = adjustment.office as { name: string } | undefined

  const available = alloc
    ? parseFloat(alloc.adjusted_amount) - parseFloat(alloc.obligated_amount)
    : null

  const isPending = adjustment.status === "pending"

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Budget Adjustment</h1>
          <p className="text-muted-foreground text-sm">
            {ADJUSTMENT_TYPE_LABELS[adjustment.adjustment_type]} — submitted{" "}
            {new Date(adjustment.created_at).toLocaleDateString("en-PH")}
          </p>
        </div>
        <Link href="/dashboard/budget/adjustments">
          <Button variant="outline" size="sm">Back to list</Button>
        </Link>
      </div>

      {/* Status & approval */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Adjustment Details</CardTitle>
            <StatusBadge status={adjustment.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Type</p>
              <p className="font-medium">{ADJUSTMENT_TYPE_LABELS[adjustment.adjustment_type]}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Amount</p>
              <AmountDisplay amount={adjustment.amount} className="text-lg font-bold" />
            </div>
            <div>
              <p className="text-muted-foreground">Office</p>
              <p className="font-medium">{office?.name ?? allocOffice?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Reference No.</p>
              <p className="font-mono text-sm">{adjustment.reference_number ?? "—"}</p>
            </div>
          </div>

          <div>
            <p className="text-muted-foreground text-sm">Justification</p>
            <p className="text-sm mt-1 leading-relaxed">{adjustment.justification}</p>
          </div>

          {adjustment.remarks && (
            <div>
              <p className="text-muted-foreground text-sm">Remarks</p>
              <p className="text-sm mt-1 leading-relaxed">{adjustment.remarks}</p>
            </div>
          )}

          {adjustment.approved_at && (
            <div>
              <p className="text-muted-foreground text-sm">
                {adjustment.status === "approved" ? "Approved" : "Reviewed"} on
              </p>
              <p className="text-sm">{new Date(adjustment.approved_at).toLocaleString("en-PH")}</p>
            </div>
          )}

          {isPending && (
            <>
              <Separator />
              <div>
                <p className="text-sm font-medium mb-3">Approval Actions</p>
                <ApprovalActions
                  onApprove={async (remarks) => {
                    "use server"
                    return approveBudgetAdjustment(id, remarks)
                  }}
                  onReject={async (remarks) => {
                    "use server"
                    return rejectBudgetAdjustment(id, remarks)
                  }}
                  requireRemarksOnReject={true}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Linked allocation */}
      {alloc && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Linked Budget Allocation</CardTitle>
            <CardDescription>
              Current balances of the allocation being adjusted
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Office</p>
                <p className="font-medium">{allocOffice?.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Fund Source</p>
                <p className="font-medium">{allocFS?.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Account Code</p>
                <p className="font-mono text-sm">{allocAC?.code}</p>
                <p className="text-xs text-muted-foreground">{allocAC?.name} — {allocAC?.expense_class}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Fiscal Year</p>
                <p className="font-medium flex items-center gap-2">
                  {allocFY?.year}
                  {allocFY && <StatusBadge status={allocFY.status} className="text-xs" />}
                </p>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Adjusted</p>
                <AmountDisplay amount={alloc.adjusted_amount} className="font-bold" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Obligated</p>
                <AmountDisplay amount={alloc.obligated_amount} className="font-bold" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Available</p>
                {available !== null && (
                  <FundAvailabilityBadge
                    availableAmount={available}
                    adjustedAmount={alloc.adjusted_amount}
                  />
                )}
              </div>
            </div>

            <Link href={`/dashboard/budget/allocations/${alloc.id}`}>
              <Button variant="outline" size="sm" className="mt-1">
                View Full Allocation
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
