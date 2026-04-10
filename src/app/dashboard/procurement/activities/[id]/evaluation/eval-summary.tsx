import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AmountDisplay } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import type { BidWithDetails } from "@/types/database"

interface CompetitiveBidEvalSummaryProps {
  bids: BidWithDetails[]
  abcAmount: string
  currentStage: string
}

export function CompetitiveBidEvalSummary({ bids, abcAmount, currentStage }: CompetitiveBidEvalSummaryProps) {
  const total = bids.length
  const evaluated = bids.filter(b => b.status === "evaluated" || b.status === "awarded").length
  const responsive = bids.filter(b => b.is_responsive && b.is_eligible && b.is_compliant)
  const disqualified = bids.filter(b => b.status === "disqualified").length
  const awarded = bids.find(b => b.status === "awarded")

  const sorted = [...responsive].sort((a, b) => parseFloat(a.bid_amount) - parseFloat(b.bid_amount))
  const lcrb = sorted[0] ?? null
  const abc = parseFloat(abcAmount)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Stats Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Evaluation Statistics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Bids Submitted</span>
            <span className="font-medium">{total}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Evaluated</span>
            <span className="font-medium">{evaluated}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Responsive / Eligible / Compliant</span>
            <span className="font-medium text-green-700">{responsive.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Disqualified</span>
            <span className="font-medium text-red-600">{disqualified}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Current Stage</span>
            <StatusBadge status={currentStage} />
          </div>
        </CardContent>
      </Card>

      {/* LCRB Card */}
      <Card className={lcrb ? "border-green-200" : undefined}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {awarded ? "Awarded Bid" : "Lowest Calculated Responsive Bid"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(awarded || lcrb) ? (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Supplier</span>
                <span className="font-medium">{(awarded || lcrb)!.supplier?.name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bid Amount</span>
                <AmountDisplay amount={(awarded || lcrb)!.bid_amount} className="font-semibold" />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ABC Amount</span>
                <AmountDisplay amount={abcAmount} />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Savings</span>
                <AmountDisplay
                  amount={(abc - parseFloat((awarded || lcrb)!.bid_amount)).toString()}
                  className="text-green-700 font-medium"
                />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={(awarded || lcrb)!.status} />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground py-4 text-center">
              No responsive bids identified yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Ranking Card */}
      {sorted.length > 1 && (
        <Card className="sm:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Bid Ranking (Responsive Bids)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-center py-2 font-medium w-12">Rank</th>
                    <th className="text-left py-2 font-medium">Supplier</th>
                    <th className="text-right py-2 font-medium">Bid Amount</th>
                    <th className="text-center py-2 font-medium">Score</th>
                    <th className="text-left py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((bid, idx) => (
                    <tr key={bid.id} className={`border-b last:border-0 ${idx === 0 ? "bg-green-50" : ""}`}>
                      <td className="py-2 text-center font-mono font-bold">{idx + 1}</td>
                      <td className="py-2 font-medium">{bid.supplier?.name ?? "—"}</td>
                      <td className="py-2 text-right"><AmountDisplay amount={bid.bid_amount} /></td>
                      <td className="py-2 text-center font-mono">{bid.evaluation_score ?? "—"}</td>
                      <td className="py-2"><StatusBadge status={bid.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
