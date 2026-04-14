import Link from "next/link"
import {
  Card,
  CardContent,
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
import { getFuelSummary, getFuelLowStockAlerts, getAllFuelRequests } from "@/lib/actions/fuel"
import { Forbidden } from "@/components/shared/forbidden"
import { FUEL_STATUS_LABELS } from "@/lib/schemas/fuel"
import {
  Fuel,
  Droplets,
  Clock,
  AlertTriangle,
  Plus,
  ArrowRight,
} from "lucide-react"

export default async function FuelDashboardPage() {
  const permissions = await getUserPermissions()

  const canView = permissions.some(p =>
    ["fuel.request", "fuel.approve", "fuel.manage_inventory", "fuel.view_reports"].includes(p)
  )

  if (!canView) {
    return <Forbidden message="You don't have permission to access fuel management." />
  }

  const canManageInventory = permissions.includes("fuel.manage_inventory")
  const canRequest = permissions.includes("fuel.request")

  const [summary, lowStockAlerts, recentRequests] = await Promise.all([
    getFuelSummary(),
    getFuelLowStockAlerts(),
    getAllFuelRequests(),
  ])

  const recent5 = recentRequests.slice(0, 5)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fuel Management</h1>
          <p className="text-muted-foreground">
            Track fuel inventory, manage trip tickets, and monitor consumption.
          </p>
        </div>
        <div className="flex gap-2">
          {canManageInventory && (
            <Button variant="outline" nativeButton={false} render={<Link href="/dashboard/fuel/inventory/stock-in" />}>
              <Droplets className="h-4 w-4 mr-1" />
              Stock In
            </Button>
          )}
          {canRequest && (
            <Button nativeButton={false} render={<Link href="/dashboard/fuel/requests/new" />}>
              <Plus className="h-4 w-4 mr-1" />
              New Trip Ticket
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Fuel Stock</CardTitle>
            <Fuel className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalStockLiters.toLocaleString()} L</div>
            <p className="text-xs text-muted-foreground">Across all offices</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Requests</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.pendingRequests}</div>
            <p className="text-xs text-muted-foreground">Awaiting approval</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved This Month</CardTitle>
            <Droplets className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.approvedThisMonth}</div>
            <p className="text-xs text-muted-foreground">Fuel requests approved</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.lowStockCount}</div>
            <p className="text-xs text-muted-foreground">Below reorder point</p>
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Alerts */}
      {lowStockAlerts.length > 0 && (
        <Card className="border-yellow-500/30 bg-yellow-50/50 dark:bg-yellow-950/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              Low Fuel Stock Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fuel Type</TableHead>
                  <TableHead>Office</TableHead>
                  <TableHead className="text-right">Current (L)</TableHead>
                  <TableHead className="text-right">Reorder Point (L)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStockAlerts.map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.fuel_type?.name ?? "—"}</TableCell>
                    <TableCell>{inv.office?.name ?? "—"}</TableCell>
                    <TableCell className="text-right text-red-600 font-medium">
                      {parseFloat(inv.current_liters).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {parseFloat(inv.reorder_point).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Recent Requests */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Recent Fuel Requests</CardTitle>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard/fuel/requests" />}>
            View All <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </CardHeader>
        <CardContent>
          {recent5.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No fuel requests yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request #</TableHead>
                  <TableHead>Fuel Type</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead className="text-right">Liters</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent5.map(req => (
                  <TableRow key={req.id}>
                    <TableCell className="font-medium">
                      <Link href={`/dashboard/fuel/requests/${req.id}`} className="hover:underline">
                        {req.request_number}
                      </Link>
                    </TableCell>
                    <TableCell>{req.fuel_type?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{req.destination}</TableCell>
                    <TableCell className="text-right">{parseFloat(req.liters_requested).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={
                        req.status === "approved" || req.status === "dispensed"
                          ? "default"
                          : req.status === "rejected" || req.status === "cancelled"
                          ? "destructive"
                          : "secondary"
                      }>
                        {FUEL_STATUS_LABELS[req.status] ?? req.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(req.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
