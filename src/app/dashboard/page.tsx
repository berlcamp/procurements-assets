import Link from "next/link"
import {
  Wallet, ShoppingCart, Package, ClipboardList,
  BarChart2, ArrowRight, AlertTriangle,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AmountDisplay } from "@/components/shared/amount-display"
import { BudgetUtilizationChart } from "@/components/budget/budget-utilization-chart"
import { StatusBadge } from "@/components/shared/status-badge"
import { getUserPermissions } from "@/lib/actions/roles"
import { getActiveFiscalYear, getBudgetUtilizationByOffice, getBudgetAllocations, getCertifiedObligationsTotal, getBudgetAdjustments } from "@/lib/actions/budget"
import { getProcurementDashboardStats } from "@/lib/actions/procurement"
import { getProcurementActivitySummary } from "@/lib/actions/procurement-activities"
import { getAssetSummary } from "@/lib/actions/assets"
import { getInventorySummary } from "@/lib/actions/inventory"
import { createClient } from "@/lib/supabase/server"

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [permissions, fiscalYear] = await Promise.all([
    getUserPermissions(),
    getActiveFiscalYear(),
  ])

  const permSet = new Set(permissions)

  // Determine widget visibility by permission groups
  const showExecutive = permSet.has("reports.all")
  const showBudget = showExecutive || permissions.some(p => p.startsWith("budget."))
  const showProcurement = showExecutive || permissions.some(p => p.startsWith("pr.") || p.startsWith("proc."))
  const showAssets = showExecutive || permissions.some(p => p.startsWith("asset.") || p.startsWith("inventory."))

  // Fetch data in parallel based on what's needed
  const [budgetUtil, allocations, certifiedObl, pendingAdj, prStats, procSummary, assetSummary, inventorySummary] = await Promise.all([
    showBudget && fiscalYear ? getBudgetUtilizationByOffice(fiscalYear.id) : Promise.resolve([]),
    showBudget && fiscalYear ? getBudgetAllocations(fiscalYear.id) : Promise.resolve([]),
    showBudget && fiscalYear ? getCertifiedObligationsTotal(fiscalYear.id) : Promise.resolve(0),
    showBudget && fiscalYear ? getBudgetAdjustments(fiscalYear.id, "pending") : Promise.resolve([]),
    showProcurement && fiscalYear ? getProcurementDashboardStats(fiscalYear.id) : Promise.resolve(null),
    showProcurement && fiscalYear ? getProcurementActivitySummary(fiscalYear.id) : Promise.resolve(null),
    showAssets ? getAssetSummary() : Promise.resolve(null),
    showAssets ? getInventorySummary() : Promise.resolve(null),
  ])

  // Budget totals
  const budgetTotals = allocations.reduce(
    (acc, a) => {
      acc.adjusted += parseFloat(a.adjusted_amount)
      acc.disbursed += parseFloat(a.disbursed_amount)
      return acc
    },
    { adjusted: 0, disbursed: 0 }
  )

  // Get user name for greeting
  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("first_name")
    .eq("id", user?.id ?? "")
    .single()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">
          {profile?.first_name ? `Welcome, ${profile.first_name}` : "Dashboard"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {fiscalYear ? `Fiscal Year ${fiscalYear.year}` : "No active fiscal year"}
        </p>
      </div>

      {/* Executive Summary (HOPE, Division Chief, Auditor, Division Admin) */}
      {showExecutive && fiscalYear && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Executive Summary</h2>
            <Link href="/dashboard/reports">
              <Button variant="ghost" size="sm">
                <BarChart2 className="mr-1.5 h-3.5 w-3.5" />
                All Reports
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Budget Utilization</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {budgetTotals.adjusted > 0
                    ? `${((certifiedObl / budgetTotals.adjusted) * 100).toFixed(1)}%`
                    : "—"}
                </div>
                <p className="text-xs text-muted-foreground">
                  <AmountDisplay amount={certifiedObl} compact /> of <AmountDisplay amount={budgetTotals.adjusted} compact />
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Procurement</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{procSummary?.active ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  active of {procSummary?.total ?? 0} total
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total Savings</CardTitle>
              </CardHeader>
              <CardContent>
                <AmountDisplay amount={procSummary?.total_savings ?? 0} className="text-xl font-bold text-emerald-600" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Active Assets</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{assetSummary?.totalActiveAssets ?? 0}</div>
                <p className="text-xs text-muted-foreground">
                  <AmountDisplay amount={assetSummary?.totalBookValue ?? 0} compact /> book value
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Budget utilization chart */}
          {budgetUtil.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Budget Utilization by Office</CardTitle>
              </CardHeader>
              <CardContent>
                <BudgetUtilizationChart data={budgetUtil} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Budget Widget */}
      {showBudget && !showExecutive && fiscalYear && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Budget</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total Budget</CardTitle>
              </CardHeader>
              <CardContent>
                <AmountDisplay amount={budgetTotals.adjusted} className="text-xl font-bold" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Obligated</CardTitle>
              </CardHeader>
              <CardContent>
                <AmountDisplay amount={certifiedObl} className="text-xl font-bold" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Available</CardTitle>
              </CardHeader>
              <CardContent>
                <AmountDisplay amount={budgetTotals.adjusted - certifiedObl} className="text-xl font-bold text-emerald-600" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Pending Adjustments</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{pendingAdj.length}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Procurement Widget */}
      {showProcurement && !showExecutive && fiscalYear && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Procurement</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total PRs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{prStats?.total_prs ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Pending Cert.</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">{prStats?.pending_certification ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Pending Approval</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">{prStats?.pending_approval ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Obligated</CardTitle>
              </CardHeader>
              <CardContent>
                <AmountDisplay amount={prStats?.total_obligated ?? 0} className="text-xl font-bold" />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Assets Widget */}
      {showAssets && !showExecutive && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Assets & Inventory</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Active Assets</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{assetSummary?.totalActiveAssets ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Book Value</CardTitle>
              </CardHeader>
              <CardContent>
                <AmountDisplay amount={assetSummary?.totalBookValue ?? 0} className="text-xl font-bold" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Inventory Items</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{inventorySummary?.totalInventoryRecords ?? 0}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Low Stock</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">
                  {inventorySummary?.lowStockCount ?? 0}
                </div>
                {(inventorySummary?.lowStockCount ?? 0) > 0 && (
                  <p className="text-xs text-orange-600 flex items-center gap-1 mt-1">
                    <AlertTriangle className="h-3 w-3" /> Needs attention
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Quick Links */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Links</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {showBudget && (
              <Link href="/dashboard/budget" className="flex items-center gap-2 rounded-md border p-3 text-sm hover:bg-muted/50 transition-colors">
                <Wallet className="h-4 w-4 text-emerald-500" />
                <span className="flex-1">Budget</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </Link>
            )}
            <Link href="/dashboard/planning" className="flex items-center gap-2 rounded-md border p-3 text-sm hover:bg-muted/50 transition-colors">
              <ClipboardList className="h-4 w-4 text-blue-500" />
              <span className="flex-1">Planning</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </Link>
            {showProcurement && (
              <Link href="/dashboard/procurement" className="flex items-center gap-2 rounded-md border p-3 text-sm hover:bg-muted/50 transition-colors">
                <ShoppingCart className="h-4 w-4 text-blue-500" />
                <span className="flex-1">Procurement</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </Link>
            )}
            {showAssets && (
              <Link href="/dashboard/assets" className="flex items-center gap-2 rounded-md border p-3 text-sm hover:bg-muted/50 transition-colors">
                <Package className="h-4 w-4 text-orange-500" />
                <span className="flex-1">Assets & Inventory</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
