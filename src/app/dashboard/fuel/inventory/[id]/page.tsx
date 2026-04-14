import { notFound } from "next/navigation"
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
import { Label } from "@/components/ui/label"
import { getUserPermissions } from "@/lib/actions/roles"
import { getFuelInventoryById, getFuelStockMovements } from "@/lib/actions/fuel"
import { Forbidden } from "@/components/shared/forbidden"
import { FUEL_MOVEMENT_TYPE_LABELS } from "@/lib/schemas/fuel"
import { ArrowLeft } from "lucide-react"

export default async function FuelInventoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const permissions = await getUserPermissions()

  if (!permissions.includes("fuel.manage_inventory")) {
    return <Forbidden message="You don't have permission to view fuel inventory details." />
  }

  const [inventory, movements] = await Promise.all([
    getFuelInventoryById(id),
    getFuelStockMovements(id),
  ])

  if (!inventory) {
    notFound()
  }

  const current = parseFloat(inventory.current_liters)
  const reorder = parseFloat(inventory.reorder_point)
  const isLow = reorder > 0 && current <= reorder

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/dashboard/fuel/inventory" />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            {inventory.fuel_type?.name ?? "Fuel"} — {inventory.office?.name ?? "Office"}
          </h1>
          <p className="text-muted-foreground">Fuel inventory detail and movement history</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Stock Info */}
        <Card>
          <CardHeader>
            <CardTitle>Stock Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-muted-foreground text-xs">Fuel Type</Label>
              <p className="font-medium">{inventory.fuel_type?.name ?? "—"}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Office</Label>
              <p className="font-medium">{inventory.office?.name ?? "—"}</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Current Stock</Label>
              <p className="text-2xl font-bold">
                {current.toLocaleString()} L
              </p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Reorder Point</Label>
              <p className="font-medium">{reorder.toLocaleString()} L</p>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs">Status</Label>
              <div className="mt-1">
                {isLow ? (
                  <Badge variant="destructive">Low Stock</Badge>
                ) : (
                  <Badge variant="default">OK</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Movement History */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Movement History</CardTitle>
          </CardHeader>
          <CardContent>
            {movements.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No stock movements recorded yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Quantity (L)</TableHead>
                    <TableHead className="text-right">Remaining (L)</TableHead>
                    <TableHead className="text-right">Price/L</TableHead>
                    <TableHead>PO #</TableHead>
                    <TableHead>Remarks</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map(mov => (
                    <TableRow key={mov.id}>
                      <TableCell className="text-sm whitespace-nowrap">
                        {new Date(mov.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          mov.movement_type === "stock_in"
                            ? "default"
                            : mov.movement_type === "stock_out"
                            ? "destructive"
                            : "secondary"
                        }>
                          {FUEL_MOVEMENT_TYPE_LABELS[mov.movement_type] ?? mov.movement_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <span className={
                          mov.movement_type === "stock_in"
                            ? "text-green-600"
                            : mov.movement_type === "stock_out"
                            ? "text-red-600"
                            : ""
                        }>
                          {mov.movement_type === "stock_in" ? "+" : mov.movement_type === "stock_out" ? "-" : ""}
                          {Math.abs(parseFloat(mov.quantity_liters)).toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {mov.remaining_liters != null
                          ? parseFloat(mov.remaining_liters).toLocaleString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {mov.price_per_liter
                          ? `${parseFloat(mov.price_per_liter).toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {mov.po_number ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm max-w-[180px] truncate">
                        {mov.remarks ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {mov.created_by_profile
                          ? `${mov.created_by_profile.first_name} ${mov.created_by_profile.last_name}`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
