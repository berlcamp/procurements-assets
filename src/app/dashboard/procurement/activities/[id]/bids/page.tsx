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
import { AbstractOfCanvass } from "@/components/procurement/abstract-of-canvass"
import { RecommendAwardButton } from "@/components/procurement/recommend-award-button"
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
  const EVAL_STAGES = [
    "quotations_received", "canvass_received",
    "evaluation", "comparison", "abstract_prepared",
    "preliminary_examination", "technical_evaluation", "financial_evaluation",
    "post_qualification", "bac_resolution",
  ]
  // Secretariat draft permission
  const canDraft = permissions.canEvaluate && activity.status === "active" &&
    EVAL_STAGES.includes(activity.current_stage)
  // BAC voting-member confirmation permission
  const canConfirm = permissions.canConfirm && activity.status === "active" &&
    EVAL_STAGES.includes(activity.current_stage)
  const hasEvaluatedBids = bids.some(b => b.status === "evaluated" || b.status === "awarded")
  // Recommend Award available from evaluation through award_recommended (so users can recover
  // from manual stage advances that bypassed the actual award action).
  const canRecommend = permissions.canRecommendAward && activity.status === "active" &&
    ["evaluation", "abstract_prepared", "comparison", "post_qualification", "award_recommended",
     "bac_resolution"].includes(activity.current_stage)
  const isCompetitiveBidding = activity.procurement_method === "competitive_bidding"
  const minBidsRequired = isCompetitiveBidding ? 2 : 3

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
              requiresBidSecurity={isCompetitiveBidding}
              bidSecurityMinAmount={isCompetitiveBidding ? parseFloat(activity.abc_amount) * 0.02 : undefined}
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
            {bids.length < minBidsRequired && activity.status === "active" && (
              <span className="text-xs text-amber-600 font-normal ml-2">
                {minBidsRequired - bids.length} more needed for minimum requirement
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
                  {canRecommend && <TableHead className="w-44" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bids.map(bid => {
                  const isAwardEligible = bid.is_responsive && bid.is_eligible && bid.is_compliant
                  const isAwarded = bid.status === "awarded"
                  return (
                    <TableRow key={bid.id} className={isAwarded ? "bg-green-50" : undefined}>
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
                      {canRecommend && (
                        <TableCell>
                          {isAwardEligible && (
                            <RecommendAwardButton
                              procurementId={id}
                              bidId={bid.id}
                              supplierName={bid.supplier?.name ?? "Supplier"}
                              bidAmount={bid.bid_amount}
                              isAlreadyAwarded={isAwarded}
                            />
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Bid Evaluation has moved to the dedicated /evaluation page so BAC
          Secretariat drafting and BAC member confirmation can share one UI. */}
      {(canDraft || canConfirm) && bids.length >= minBidsRequired && (
        <Card className="border-blue-300 bg-blue-50">
          <CardContent className="flex items-start justify-between gap-3 py-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-blue-900">
                {canDraft ? "Draft the BAC Evaluation" : "Confirm the BAC Evaluation"}
              </p>
              <p className="text-xs text-blue-800">
                {canDraft
                  ? "Enter the evaluation verdicts. Saving invalidates any prior BAC member confirmations."
                  : "Review the BAC Secretariat's draft and confirm your agreement."}
              </p>
            </div>
            <Button size="sm" nativeButton={false} render={<Link href={`/dashboard/procurement/activities/${id}/evaluation`} />}>
              Open Evaluation
            </Button>
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
