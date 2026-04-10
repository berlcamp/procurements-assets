import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import {
  getProcurementActivityById,
  getBidsForProcurement,
  getProcurementUserPermissions,
} from "@/lib/actions/procurement-activities"
import { PROCUREMENT_METHOD_LABELS } from "@/lib/schemas/procurement"
import { BidEvaluationForm } from "@/components/procurement/bid-evaluation-form"
import { CompetitiveBidEvalSummary } from "./eval-summary"
import type { BidWithDetails } from "@/types/database"

export default async function EvaluationPage({
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

  const canEvaluate = permissions.canEvaluate && activity.status === "active" &&
    ["preliminary_examination", "technical_evaluation", "financial_evaluation",
     "post_qualification", "bac_resolution"].includes(activity.current_stage)

  const evaluatedBids = bids.filter(b => b.status === "evaluated" || b.status === "awarded")
  const responsiveBids = bids.filter(b => b.is_responsive && b.is_eligible && b.is_compliant)
  const lcrb = responsiveBids.length > 0
    ? responsiveBids.reduce((lowest, b) =>
        parseFloat(b.bid_amount) < parseFloat(lowest.bid_amount) ? b : lowest
      )
    : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">Bid Evaluation</h1>
            <StatusBadge status={activity.procurement_method} />
            <StatusBadge status={activity.current_stage} />
          </div>
          <p className="text-sm text-muted-foreground">
            {activity.procurement_number} · {PROCUREMENT_METHOD_LABELS[activity.procurement_method]}
          </p>
        </div>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/dashboard/procurement/activities/${id}`} />}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
      </div>

      {/* LCRB Summary */}
      {lcrb && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-900">
                  Lowest Calculated Responsive Bid (LCRB)
                </p>
                <p className="text-xs text-green-800 mt-0.5">
                  {lcrb.supplier?.name} — Rank #{lcrb.rank ?? 1}
                </p>
              </div>
              <AmountDisplay amount={lcrb.bid_amount} className="text-lg font-bold text-green-900" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Evaluation Tabs */}
      <Tabs defaultValue="technical">
        <TabsList>
          <TabsTrigger value="technical">Technical Evaluation</TabsTrigger>
          <TabsTrigger value="financial">Financial Evaluation</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="technical" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Technical Evaluation</CardTitle>
              <p className="text-xs text-muted-foreground">
                Evaluate each bid for responsiveness, eligibility, and compliance with technical requirements.
              </p>
            </CardHeader>
            <CardContent>
              {bids.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No bids recorded yet.
                </p>
              ) : canEvaluate ? (
                <BidEvaluationForm
                  procurementId={id}
                  bids={bids}
                />
              ) : (
                <TechnicalSummaryTable bids={bids} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financial" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Financial Evaluation</CardTitle>
              <p className="text-xs text-muted-foreground">
                Compare bid amounts of responsive, eligible, and compliant bidders.
                {evaluatedBids.length === 0 && " Complete technical evaluation first."}
              </p>
            </CardHeader>
            <CardContent>
              {responsiveBids.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No responsive bids yet. Complete technical evaluation first.
                </p>
              ) : (
                <FinancialComparisonTable bids={responsiveBids} abcAmount={activity.abc_amount} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="mt-4">
          <CompetitiveBidEvalSummary
            bids={bids}
            abcAmount={activity.abc_amount}
            currentStage={activity.current_stage}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TechnicalSummaryTable({ bids }: { bids: BidWithDetails[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 font-medium">Supplier</th>
            <th className="text-right py-2 font-medium">Bid Amount</th>
            <th className="text-center py-2 font-medium">Responsive</th>
            <th className="text-center py-2 font-medium">Eligible</th>
            <th className="text-center py-2 font-medium">Compliant</th>
            <th className="text-center py-2 font-medium">Score</th>
            <th className="text-left py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {bids.map(bid => (
            <tr key={bid.id} className="border-b last:border-0">
              <td className="py-2 font-medium">{bid.supplier?.name ?? "—"}</td>
              <td className="py-2 text-right"><AmountDisplay amount={bid.bid_amount} /></td>
              <td className="py-2 text-center">{bid.is_responsive ? "Pass" : "Fail"}</td>
              <td className="py-2 text-center">{bid.is_eligible ? "Pass" : "Fail"}</td>
              <td className="py-2 text-center">{bid.is_compliant ? "Pass" : "Fail"}</td>
              <td className="py-2 text-center font-mono">{bid.evaluation_score ?? "—"}</td>
              <td className="py-2"><StatusBadge status={bid.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FinancialComparisonTable({ bids, abcAmount }: { bids: BidWithDetails[]; abcAmount: string }) {
  const sorted = [...bids].sort((a, b) => parseFloat(a.bid_amount) - parseFloat(b.bid_amount))
  const abc = parseFloat(abcAmount)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-center py-2 font-medium w-12">Rank</th>
            <th className="text-left py-2 font-medium">Supplier</th>
            <th className="text-right py-2 font-medium">Bid Amount</th>
            <th className="text-right py-2 font-medium">% of ABC</th>
            <th className="text-right py-2 font-medium">Savings vs ABC</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((bid, idx) => {
            const amount = parseFloat(bid.bid_amount)
            const pctOfAbc = abc > 0 ? ((amount / abc) * 100).toFixed(1) : "—"
            const savings = abc - amount
            return (
              <tr key={bid.id} className={`border-b last:border-0 ${idx === 0 ? "bg-green-50" : ""}`}>
                <td className="py-2 text-center font-mono font-bold">{idx + 1}</td>
                <td className="py-2 font-medium">
                  {bid.supplier?.name ?? "—"}
                  {idx === 0 && <span className="ml-2 text-xs text-green-700 font-normal">LCRB</span>}
                </td>
                <td className="py-2 text-right"><AmountDisplay amount={bid.bid_amount} /></td>
                <td className="py-2 text-right font-mono">{pctOfAbc}%</td>
                <td className="py-2 text-right">
                  <AmountDisplay amount={savings.toString()} className={savings >= 0 ? "text-green-700" : "text-red-600"} />
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2">
            <td colSpan={2} className="py-2 font-medium">Approved Budget for the Contract (ABC)</td>
            <td className="py-2 text-right"><AmountDisplay amount={abcAmount} className="font-bold" /></td>
            <td className="py-2 text-right font-mono">100%</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
