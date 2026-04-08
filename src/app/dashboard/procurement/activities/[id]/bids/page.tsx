import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import {
  getProcurementActivityById,
  getBidsForProcurement,
  getProcurementUserPermissions,
} from "@/lib/actions/procurement-activities"
import { getPurchaseRequestById } from "@/lib/actions/procurement"
import { PROCUREMENT_METHOD_LABELS } from "@/lib/schemas/procurement"
import { RecordBidDialog } from "@/components/procurement/record-bid-dialog"
import { BidEvaluationForm } from "@/components/procurement/bid-evaluation-form"
import { AbstractOfCanvass } from "@/components/procurement/abstract-of-canvass"
import type { BidWithDetails, PrItem } from "@/types/database"

function BoolIcon({ value }: { value: boolean }) {
  return value
    ? <Check className="h-4 w-4 text-green-600" />
    : <X className="h-4 w-4 text-red-500" />
}

export default async function BidsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [activity, bids, permissions] = await Promise.all([
    getProcurementActivityById(id),
    getBidsForProcurement(id),
    getProcurementUserPermissions(id),
  ])

  if (!activity) notFound()

  // Get PR items for the abstract of canvass
  const pr = activity.purchase_request
  let prItems: PrItem[] = []
  if (pr) {
    const prFull = await getPurchaseRequestById(pr.id)
    prItems = prFull?.pr_items ?? []
  }

  const canRecord = permissions.canRecordBid && activity.status === "active"
  const canEvaluate = permissions.canEvaluate && activity.status === "active" &&
    ["quotations_received", "canvass_received", "evaluation", "comparison", "abstract_prepared"].includes(activity.current_stage)
  const hasEvaluatedBids = bids.some(b => b.status === "evaluated" || b.status === "awarded")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">Bids & Quotations</h1>
            <StatusBadge status={activity.procurement_method} />
          </div>
          <p className="text-sm text-muted-foreground">
            {activity.procurement_number} · {PROCUREMENT_METHOD_LABELS[activity.procurement_method]}
          </p>
        </div>
        <div className="flex gap-2">
          {canRecord && (
            <RecordBidDialog
              procurementId={id}
              prItems={prItems}
              abcAmount={activity.abc_amount}
            />
          )}
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/dashboard/procurement/activities/${id}`} />}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
        </div>
      </div>

      {/* Bids Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Submitted Bids ({bids.length})
            {bids.length < 3 && activity.status === "active" && (
              <span className="text-xs text-amber-600 font-normal ml-2">
                {3 - bids.length} more needed for minimum requirement
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {bids.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No bids recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Bid Amount</TableHead>
                  <TableHead className="text-center">Responsive</TableHead>
                  <TableHead className="text-center">Eligible</TableHead>
                  <TableHead className="text-center">Compliant</TableHead>
                  <TableHead className="text-center">Rank</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bids.map(bid => (
                  <TableRow key={bid.id} className={bid.status === "awarded" ? "bg-green-50" : undefined}>
                    <TableCell>
                      <div>
                        <span className="font-medium text-sm">{bid.supplier?.name ?? "—"}</span>
                        {bid.supplier?.tin && (
                          <span className="block text-xs text-muted-foreground font-mono">{bid.supplier.tin}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={bid.bid_amount} />
                    </TableCell>
                    <TableCell className="text-center"><BoolIcon value={bid.is_responsive} /></TableCell>
                    <TableCell className="text-center"><BoolIcon value={bid.is_eligible} /></TableCell>
                    <TableCell className="text-center"><BoolIcon value={bid.is_compliant} /></TableCell>
                    <TableCell className="text-center font-mono">
                      {bid.rank ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={bid.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Bid Evaluation Form (for BAC) */}
      {canEvaluate && bids.length >= 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evaluate Bids</CardTitle>
          </CardHeader>
          <CardContent>
            <BidEvaluationForm
              procurementId={id}
              bids={bids}
            />
          </CardContent>
        </Card>
      )}

      {/* Abstract of Canvass */}
      {hasEvaluatedBids && prItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Abstract of Canvass</CardTitle>
          </CardHeader>
          <CardContent>
            <AbstractOfCanvass
              prItems={prItems}
              bids={bids}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
