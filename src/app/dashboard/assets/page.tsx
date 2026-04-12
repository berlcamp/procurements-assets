import Link from "next/link"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getUserPermissions } from "@/lib/actions/roles"
import {
  getInventorySummary,
  getReorderAlerts,
} from "@/lib/actions/inventory"
import { Forbidden } from "@/components/shared/forbidden"
import {
  Package,
  AlertTriangle,
  ClipboardList,
  BarChart3,
  ArrowRight,
} from "lucide-react"

export default async function AssetDashboardPage() {
  const permissions = await getUserPermissions()

  const canView = permissions.some(p =>
    ["asset.manage", "asset.view_own", "inventory.manage", "asset.assign", "asset.dispose"].includes(p)
  )

  if (!canView) {
    return (
      <Forbidden message="You don't have permission to view inventory. Contact your administrator." />
    )
  }

  const canManage = permissions.some(p =>
    ["inventory.manage", "asset.manage"].includes(p)
  )

  const [summary, reorderAlerts] = await Promise.all([
    getInventorySummary(),
    getReorderAlerts(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-muted-foreground">
            Track stock levels, manage items, and monitor reorder alerts.
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Catalog Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalCatalogItems}</div>
            <p className="text-xs text-muted-foreground">Active items in catalog</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inventory Records</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalInventoryRecords}</div>
            <p className="text-xs text-muted-foreground">Items tracked across offices</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {summary.lowStockCount}
            </div>
            <p className="text-xs text-muted-foreground">Below reorder point</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ready for Stock-In</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.deliveriesReadyCount}</div>
            <p className="text-xs text-muted-foreground">Inspected deliveries pending</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <Button
              variant="outline"
              className="w-full justify-between"
              nativeButton={false}
              render={<Link href="/dashboard/assets/inventory" />}
            >
              View Inventory
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
        {canManage && (
          <>
            <Card>
              <CardContent className="pt-6">
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  nativeButton={false}
                  render={<Link href="/dashboard/admin/item-catalog" />}
                >
                  Item Catalog
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <Button
                  variant="outline"
                  className="w-full justify-between"
                  nativeButton={false}
                  render={<Link href="/dashboard/assets/inventory/physical-count" />}
                >
                  Physical Count
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Reorder Alerts */}
      {reorderAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Reorder Alerts
            </CardTitle>
            <CardDescription>
              Items that have reached or fallen below their reorder point.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Office</TableHead>
                  <TableHead className="text-right">Current Qty</TableHead>
                  <TableHead className="text-right">Reorder Point</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reorderAlerts.slice(0, 10).map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <div>
                        <span className="font-medium">
                          {inv.item_catalog?.name ?? "Unknown"}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground font-mono">
                          {inv.item_catalog?.code}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {inv.office?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-orange-600 font-medium">
                      {parseFloat(inv.current_quantity).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {parseFloat(inv.reorder_point).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        nativeButton={false}
                        render={<Link href={`/dashboard/assets/inventory/${inv.id}`} />}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {reorderAlerts.length > 10 && (
              <p className="text-sm text-muted-foreground text-center mt-4">
                Showing 10 of {reorderAlerts.length} alerts.{" "}
                <Link href="/dashboard/assets/inventory" className="underline">
                  View all inventory
                </Link>
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
