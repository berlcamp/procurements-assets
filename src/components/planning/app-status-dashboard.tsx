import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AmountDisplay } from "@/components/shared/amount-display"
import type { AppSummary } from "@/types/database"

interface AppStatusDashboardProps {
  summary: AppSummary
}

function StatItem({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold ${color ?? ""}`}>{value}</span>
    </div>
  )
}

export function AppStatusDashboard({ summary }: AppStatusDashboardProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">HOPE Review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <StatItem label="Total Items" value={summary.total_items} />
          <StatItem label="Pending" value={summary.pending_items} color="text-yellow-600" />
          <StatItem label="Approved" value={summary.approved_items} color="text-green-600" />
          <StatItem label="Remarked" value={summary.remarked_items} color="text-orange-600" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">BAC Lots</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <StatItem label="Total Lots" value={summary.total_lots} />
          <StatItem label="Finalized" value={summary.finalized_lots} color="text-green-600" />
          <StatItem label="Draft" value={summary.draft_lots} color="text-yellow-600" />
          <StatItem label="Unlotted Items" value={summary.unlotted_items} color="text-orange-600" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Budget</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <StatItem label="Lotted Items" value={summary.lotted_items} />
          <div className="flex justify-between items-center pt-2 border-t">
            <span className="text-sm text-muted-foreground">Total</span>
            <AmountDisplay amount={summary.total_budget} className="text-sm font-semibold" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
