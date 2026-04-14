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
import { Progress } from "@/components/ui/progress"
import { getUserPermissions } from "@/lib/actions/roles"
import { getFuelInventoryList } from "@/lib/actions/fuel"
import { Forbidden } from "@/components/shared/forbidden"
import { Droplets, Plus } from "lucide-react"

export default async function FuelInventoryPage() {
  const permissions = await getUserPermissions()

  if (!permissions.includes("fuel.manage_inventory")) {
    return <Forbidden message="You don't have permission to manage fuel inventory." />
  }

  const inventory = await getFuelInventoryList()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fuel Inventory</h1>
          <p className="text-muted-foreground">
            Monitor fuel stock levels across offices.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/dashboard/fuel/inventory/stock-in" />}>
          <Plus className="h-4 w-4 mr-1" />
          Stock In
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stock Levels</CardTitle>
        </CardHeader>
        <CardContent>
          {inventory.length === 0 ? (
            <div className="text-center py-12">
              <Droplets className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No fuel inventory records yet.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Start by adding fuel stock via the Stock In button above.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fuel Type</TableHead>
                  <TableHead>Office</TableHead>
                  <TableHead className="text-right">Current (L)</TableHead>
                  <TableHead className="text-right">Reorder Point (L)</TableHead>
                  <TableHead className="w-[200px]">Level</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.map(inv => {
                  const current = parseFloat(inv.current_liters)
                  const reorder = parseFloat(inv.reorder_point)
                  const isLow = reorder > 0 && current <= reorder
                  // Use reorder * 2 as a rough "full" gauge, minimum 100
                  const maxGauge = Math.max(reorder * 2, current, 100)
                  const pct = Math.min((current / maxGauge) * 100, 100)

                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">
                        {inv.fuel_type?.name ?? "—"}
                      </TableCell>
                      <TableCell>{inv.office?.name ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {current.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {reorder.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Progress
                          value={pct}
                          className="h-2"
                        />
                      </TableCell>
                      <TableCell>
                        {isLow ? (
                          <Badge variant="destructive">Low</Badge>
                        ) : (
                          <Badge variant="default">OK</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          nativeButton={false}
                          render={<Link href={`/dashboard/fuel/inventory/${inv.id}`} />}
                        >
                          Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
