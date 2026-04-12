import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { getPurchaseOrders, getPosRequiringMyAction } from "@/lib/actions/purchase-orders"
import { getUserPermissions } from "@/lib/actions/roles"
import { format } from "date-fns"
import type { PurchaseOrderWithDetails } from "@/types/database"

function PoTable({ pos }: { pos: PurchaseOrderWithDetails[] }) {
  if (pos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No Purchase Orders found.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>PO Number</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Date</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {pos.map(po => (
          <TableRow key={po.id}>
            <TableCell className="font-mono text-sm">{po.po_number}</TableCell>
            <TableCell className="text-sm">
              {po.supplier?.name ?? "—"}
            </TableCell>
            <TableCell className="text-sm capitalize">
              {po.procurement?.procurement_method?.replace(/_/g, " ") ?? "—"}
            </TableCell>
            <TableCell className="text-right">
              <AmountDisplay amount={po.total_amount} />
            </TableCell>
            <TableCell>
              <StatusBadge status={po.status} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {format(new Date(po.created_at), "MMM d, yyyy")}
            </TableCell>
            <TableCell>
              <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/procurement/purchase-orders/${po.id}`} />}>
                View
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default async function PurchaseOrdersPage() {
  const [allPos, actionPos, permissions] = await Promise.all([
    getPurchaseOrders(),
    getPosRequiringMyAction(),
    getUserPermissions(),
  ])

  const canCreate = permissions.includes("po.create") || permissions.includes("proc.manage")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Purchase Orders</h1>
          <p className="text-muted-foreground">
            Manage purchase orders from awarded procurements
          </p>
        </div>
        {canCreate && (
          <p className="text-sm text-muted-foreground">
            Create POs from the Activities page
          </p>
        )}
      </div>

      {actionPos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Requires My Action ({actionPos.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <PoTable pos={actionPos} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Purchase Orders ({allPos.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <PoTable pos={allPos} />
        </CardContent>
      </Card>
    </div>
  )
}
