import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { getDeliveries, getDeliveriesRequiringInspection } from "@/lib/actions/purchase-orders"
import { INSPECTION_STATUS_LABELS } from "@/lib/schemas/procurement"
import { format } from "date-fns"
import type { DeliveryWithItems } from "@/types/database"

const inspectionVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  passed: "default",
  failed: "destructive",
  partial_acceptance: "secondary",
}

function DeliveryTable({ deliveries }: { deliveries: DeliveryWithItems[] }) {
  if (deliveries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No deliveries found.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Delivery #</TableHead>
          <TableHead>PO Number</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Items</TableHead>
          <TableHead>Inspection</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {deliveries.map(delivery => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const po = (delivery as any).purchase_order as {
            id: string
            po_number: string
            supplier?: { name: string } | null
            office?: { name: string } | null
          } | null
          return (
            <TableRow key={delivery.id}>
              <TableCell className="font-mono text-sm">{delivery.delivery_number}</TableCell>
              <TableCell className="text-sm">
                {po ? (
                  <Link
                    href={`/dashboard/procurement/purchase-orders/${po.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {po.po_number}
                  </Link>
                ) : "—"}
              </TableCell>
              <TableCell className="text-sm">{po?.supplier?.name ?? "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {format(new Date(delivery.delivery_date), "MMM d, yyyy")}
              </TableCell>
              <TableCell className="text-sm">{delivery.delivery_items?.length ?? 0} items</TableCell>
              <TableCell>
                <Badge variant={inspectionVariants[delivery.inspection_status] ?? "outline"}>
                  {INSPECTION_STATUS_LABELS[delivery.inspection_status] ?? delivery.inspection_status}
                </Badge>
              </TableCell>
              <TableCell>
                <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/procurement/deliveries/${delivery.id}`} />}>
                  View
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export default async function DeliveriesPage() {
  const [allDeliveries, pendingInspection] = await Promise.all([
    getDeliveries(),
    getDeliveriesRequiringInspection(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deliveries</h1>
        <p className="text-muted-foreground">
          Track deliveries and manage inspections
        </p>
      </div>

      {pendingInspection.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Pending Inspection ({pendingInspection.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DeliveryTable deliveries={pendingInspection} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Deliveries ({allDeliveries.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <DeliveryTable deliveries={allDeliveries} />
        </CardContent>
      </Card>
    </div>
  )
}
