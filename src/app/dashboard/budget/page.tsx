import Link from "next/link"
import {
  getActiveFiscalYear,
  getBudgetAllocations,
  getBudgetAdjustments,
  getBudgetUtilizationByOffice,
  getCertifiedObligationsTotal,
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
import { BudgetUtilizationChart } from "@/components/budget/budget-utilization-chart"
import { StatusBadge } from "@/components/shared/status-badge"
import { PlusIcon, LayoutListIcon, ArrowRightLeftIcon, FileBarChartIcon } from "lucide-react"

export default async function BudgetDashboardPage() {
  const fiscalYear = await getActiveFiscalYear()

  const [allocations, pendingAdjustments, utilization, certifiedObligated] =
    await Promise.all([
      fiscalYear ? getBudgetAllocations(fiscalYear.id) : Promise.resolve([]),
      fiscalYear
        ? getBudgetAdjustments(fiscalYear.id, "pending")
        : Promise.resolve([]),
      fiscalYear
        ? getBudgetUtilizationByOffice(fiscalYear.id)
        : Promise.resolve([]),
      fiscalYear
        ? getCertifiedObligationsTotal(fiscalYear.id)
        : Promise.resolve(0),
    ])

  const totals = allocations.reduce(
    (acc, a) => {
      acc.adjusted += parseFloat(a.adjusted_amount)
      acc.disbursed += parseFloat(a.disbursed_amount)
      return acc
    },
    { adjusted: 0, disbursed: 0 }
  )

  const obligated = certifiedObligated
  const available = totals.adjusted - obligated

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Budget</h1>
          {fiscalYear ? (
            <p className="text-muted-foreground">
              Fiscal Year {fiscalYear.year} &mdash;{" "}
              <StatusBadge status={fiscalYear.status} className="text-xs" />
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              No active fiscal year.{" "}
              <Link href="/dashboard/admin/fiscal-years" className="underline">
                Set one up
              </Link>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/budget/allocations/new">
            <Button size="sm">
              <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
              New Allocation
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Total Budget
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AmountDisplay amount={totals.adjusted} className="text-xl font-bold" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Obligated
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AmountDisplay amount={obligated} className="text-xl font-bold" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Disbursed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AmountDisplay amount={totals.disbursed} className="text-xl font-bold" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Available
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AmountDisplay
              amount={available}
              className="text-xl font-bold text-emerald-600"
            />
          </CardContent>
        </Card>
      </div>

      {/* Utilization chart + quick links */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Utilization by Office</CardTitle>
            <CardDescription>Obligated vs. adjusted budget per office</CardDescription>
          </CardHeader>
          <CardContent>
            <BudgetUtilizationChart data={utilization} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Pending adjustments */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pending Adjustments</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{pendingAdjustments.length}</p>
              <p className="text-xs text-muted-foreground mt-1">awaiting approval</p>
              <Link href="/dashboard/budget/adjustments?status=pending" className="block mt-3">
                <Button variant="outline" size="sm" className="w-full">
                  Review
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Quick nav */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/dashboard/budget/allocations" className="flex items-center gap-2 text-sm hover:underline">
                <LayoutListIcon className="h-4 w-4 text-muted-foreground" />
                All Allocations ({allocations.length})
              </Link>
              <Link href="/dashboard/budget/adjustments" className="flex items-center gap-2 text-sm hover:underline">
                <ArrowRightLeftIcon className="h-4 w-4 text-muted-foreground" />
                Adjustments
              </Link>
              <Link href="/dashboard/budget/reports" className="flex items-center gap-2 text-sm hover:underline">
                <FileBarChartIcon className="h-4 w-4 text-muted-foreground" />
                Reports
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
