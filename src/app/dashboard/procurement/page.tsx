import Link from "next/link"
import { FileText, ShoppingCart, Building, Clock, CheckCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { getActiveFiscalYear } from "@/lib/actions/budget"
import {
  getProcurementDashboardStats,
  getPrsRequiringMyAction,
} from "@/lib/actions/procurement"
import { getUserPermissions } from "@/lib/actions/roles"

export default async function ProcurementDashboardPage() {
  const fiscalYear = await getActiveFiscalYear()
  const [stats, actionPrs, permissions] = await Promise.all([
    fiscalYear ? getProcurementDashboardStats(fiscalYear.id) : null,
    getPrsRequiringMyAction(),
    getUserPermissions(),
  ])

  const canCreatePr = permissions.includes("pr.create")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Procurement</h1>
        <p className="text-sm text-muted-foreground">
          Purchase Requests and Supplier Registry
          {fiscalYear && <> · FY {fiscalYear.year}</>}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats?.total_prs ?? 0}</div>
            <p className="text-sm text-muted-foreground">Total PRs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-yellow-600">{stats?.pending_certification ?? 0}</div>
            <p className="text-sm text-muted-foreground">Pending Certification</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-yellow-600">{stats?.pending_approval ?? 0}</div>
            <p className="text-sm text-muted-foreground">Pending Approval</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {stats ? <AmountDisplay amount={stats.total_obligated} /> : "—"}
            </div>
            <p className="text-sm text-muted-foreground">Total Obligated</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Requires action */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-500" />
                Requires My Action
              </CardTitle>
            </CardHeader>
            <CardContent>
              {actionPrs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No Purchase Requests require your action right now.
                </p>
              ) : (
                <div className="space-y-2">
                  {actionPrs.slice(0, 5).map(pr => (
                    <div key={pr.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-medium">{pr.pr_number}</p>
                        <p className="text-xs text-muted-foreground truncate">{pr.office?.name}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <AmountDisplay amount={pr.total_estimated_cost} className="text-sm" />
                        <StatusBadge status={pr.status} />
                        <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/procurement/purchase-requests/${pr.id}`} />}>
                          View
                        </Button>
                      </div>
                    </div>
                  ))}
                  {actionPrs.length > 5 && (
                    <Button variant="link" size="sm" nativeButton={false} render={<Link href="/dashboard/procurement/purchase-requests" />}>
                      View all {actionPrs.length} →
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" nativeButton={false} render={<Link href="/dashboard/procurement/purchase-requests" />}>
                <FileText className="mr-2 h-4 w-4" /> Purchase Requests
              </Button>
              <Button variant="outline" className="w-full justify-start" nativeButton={false} render={<Link href="/dashboard/procurement/suppliers" />}>
                <Building className="mr-2 h-4 w-4" /> Supplier Registry
              </Button>
              {canCreatePr && (
                <Button className="w-full justify-start" nativeButton={false} render={<Link href="/dashboard/procurement/purchase-requests/new" />}>
                  <ShoppingCart className="mr-2 h-4 w-4" /> New Purchase Request
                </Button>
              )}
            </CardContent>
          </Card>

          {fiscalYear && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Active Fiscal Year
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{fiscalYear.year}</p>
                <StatusBadge status={fiscalYear.status} className="mt-1" />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
