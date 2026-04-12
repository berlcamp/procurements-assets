import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/status-badge"
import { DeliveryInspectionForm } from "@/components/procurement/delivery-inspection-form"
import { PoSummaryDialog } from "@/components/procurement/po-summary-dialog"
import { getDeliveryById } from "@/lib/actions/purchase-orders"
import { getUserPermissions } from "@/lib/actions/roles"
import { INSPECTION_STATUS_LABELS } from "@/lib/schemas/procurement"
import { format } from "date-fns"

const inspectionVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  passed: "default",
  failed: "destructive",
  partial_acceptance: "secondary",
}

export default async function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [delivery, permissions] = await Promise.all([
    getDeliveryById(id),
    getUserPermissions(),
  ])

  if (!delivery) notFound()

  const canInspect =
    (permissions.includes("delivery.inspect") || permissions.includes("proc.manage")) &&
    delivery.inspection_status === "pending"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/dashboard/procurement/deliveries" />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              {delivery.delivery_number}
            </h1>
            <Badge variant={inspectionVariants[delivery.inspection_status] ?? "outline"}>
              {INSPECTION_STATUS_LABELS[delivery.inspection_status] ?? delivery.inspection_status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Delivered on {format(new Date(delivery.delivery_date), "MMMM d, yyyy")}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Delivery Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Delivery Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Delivery Number</dt>
                  <dd className="font-medium font-mono">{delivery.delivery_number}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Delivery Date</dt>
                  <dd>{format(new Date(delivery.delivery_date), "MMM d, yyyy")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Received By</dt>
                  <dd>{delivery.received_by_profile ? `${delivery.received_by_profile.first_name} ${delivery.received_by_profile.last_name}` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Inspection Status</dt>
                  <dd>
                    <Badge variant={inspectionVariants[delivery.inspection_status] ?? "outline"}>
                      {INSPECTION_STATUS_LABELS[delivery.inspection_status] ?? delivery.inspection_status}
                    </Badge>
                  </dd>
                </div>
                {delivery.inspection_date && (
                  <div>
                    <dt className="text-muted-foreground">Inspection Date</dt>
                    <dd>{format(new Date(delivery.inspection_date), "MMM d, yyyy")}</dd>
                  </div>
                )}
                {delivery.inspected_by_profile && (
                  <div>
                    <dt className="text-muted-foreground">Inspected By</dt>
                    <dd>{`${delivery.inspected_by_profile.first_name} ${delivery.inspected_by_profile.last_name}`}</dd>
                  </div>
                )}
                {delivery.inspection_report_number && (
                  <div>
                    <dt className="text-muted-foreground">Report Number</dt>
                    <dd className="font-mono">{delivery.inspection_report_number}</dd>
                  </div>
                )}
                {delivery.remarks && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Remarks</dt>
                    <dd>{delivery.remarks}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Delivery Items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Delivered Items ({delivery.delivery_items?.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {delivery.delivery_items && delivery.delivery_items.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-20">Unit</TableHead>
                      <TableHead className="w-24 text-right">Delivered</TableHead>
                      <TableHead className="w-24 text-right">Accepted</TableHead>
                      <TableHead className="w-24 text-right">Rejected</TableHead>
                      <TableHead>Rejection Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {delivery.delivery_items.map((item, i) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">
                          {item.po_item?.description ?? "—"}
                        </TableCell>
                        <TableCell>{item.po_item?.unit ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {parseFloat(item.quantity_delivered)}
                        </TableCell>
                        <TableCell className="text-right">
                          {parseFloat(item.quantity_accepted) > 0 ? (
                            <span className="text-green-600">{parseFloat(item.quantity_accepted)}</span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {parseFloat(item.quantity_rejected) > 0 ? (
                            <span className="text-red-600">{parseFloat(item.quantity_rejected)}</span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.rejection_reason ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No items.</p>
              )}
            </CardContent>
          </Card>

          {/* Inspection Form */}
          {canInspect && delivery.delivery_items && delivery.delivery_items.length > 0 && (
            <DeliveryInspectionForm
              deliveryId={delivery.id}
              deliveryNumber={delivery.delivery_number}
              items={delivery.delivery_items}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {(delivery as any).purchase_order && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Purchase Order</CardTitle>
              </CardHeader>
              <CardContent>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <PoSummaryDialog po={(delivery as any).purchase_order} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Received</span>
                <span>{format(new Date(delivery.delivery_date), "MMM d, yyyy")}</span>
              </div>
              {delivery.inspection_date && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Inspected</span>
                  <span>{format(new Date(delivery.inspection_date), "MMM d, yyyy")}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{format(new Date(delivery.created_at), "MMM d, yyyy")}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
