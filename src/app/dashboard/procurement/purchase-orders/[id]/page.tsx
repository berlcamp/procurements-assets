import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ApprovalStepper, buildPoSteps } from "@/components/shared/approval-stepper"
import { AmountDisplay, formatPeso } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import { PoItemsTable } from "@/components/procurement/po-items-table"
import { PoReviewActions } from "@/components/procurement/po-review-actions"
import { PoDeliveriesSection } from "@/components/procurement/po-deliveries-section"
import { DeliveryForm } from "@/components/procurement/delivery-form"
import { getPurchaseOrderById } from "@/lib/actions/purchase-orders"
import { getUserPermissions } from "@/lib/actions/roles"
import { PO_STATUS_LABELS } from "@/lib/schemas/procurement"
import { format } from "date-fns"

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [po, permissions] = await Promise.all([
    getPurchaseOrderById(id),
    getUserPermissions(),
  ])

  if (!po) notFound()

  const canApprove = permissions.includes("po.approve") || permissions.includes("proc.manage")
  const canIssue = permissions.includes("po.create") || permissions.includes("proc.manage")
  const canCancel = permissions.includes("po.create") || permissions.includes("proc.manage")
  const canRecordDelivery =
    permissions.includes("po.create") ||
    permissions.includes("delivery.inspect") ||
    permissions.includes("proc.manage")

  const showDeliveryForm =
    canRecordDelivery && ["issued", "partially_delivered"].includes(po.status)

  const steps = buildPoSteps(po.status)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/dashboard/procurement/purchase-orders" />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{po.po_number}</h1>
            <StatusBadge status={po.status} />
          </div>
          <p className="text-muted-foreground text-sm">
            {po.supplier?.name ?? "—"} &middot; {po.office?.name ?? "—"}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* PO Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Purchase Order Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">PO Number</dt>
                  <dd className="font-medium font-mono">{po.po_number}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Procurement</dt>
                  <dd>
                    {po.procurement ? (
                      <Link
                        href={`/dashboard/procurement/activities/${po.procurement.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {po.procurement.procurement_number}
                      </Link>
                    ) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Supplier</dt>
                  <dd className="font-medium">{po.supplier?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Supplier TIN</dt>
                  <dd className="font-mono">{po.supplier?.tin ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Total Amount</dt>
                  <dd className="font-semibold">
                    <AmountDisplay amount={po.total_amount} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>{PO_STATUS_LABELS[po.status] ?? po.status}</dd>
                </div>
                {po.delivery_date && (
                  <div>
                    <dt className="text-muted-foreground">Delivery Date</dt>
                    <dd>{format(new Date(po.delivery_date), "MMM d, yyyy")}</dd>
                  </div>
                )}
                {po.delivery_address && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Delivery Address</dt>
                    <dd>{po.delivery_address}</dd>
                  </div>
                )}
                {po.payment_terms && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Payment Terms</dt>
                    <dd>{po.payment_terms}</dd>
                  </div>
                )}
                {po.approved_at && (
                  <div>
                    <dt className="text-muted-foreground">Approved</dt>
                    <dd>{format(new Date(po.approved_at), "MMM d, yyyy h:mm a")}</dd>
                  </div>
                )}
                {po.issued_at && (
                  <div>
                    <dt className="text-muted-foreground">Issued</dt>
                    <dd>{format(new Date(po.issued_at), "MMM d, yyyy h:mm a")}</dd>
                  </div>
                )}
                {po.cancellation_reason && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Cancellation Reason</dt>
                    <dd className="text-destructive">{po.cancellation_reason}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Line Items ({po.po_items?.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {po.po_items && po.po_items.length > 0 ? (
                <PoItemsTable
                  items={po.po_items}
                  showDeliveryProgress={["issued", "partially_delivered", "fully_delivered", "completed"].includes(po.status)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No line items.</p>
              )}
            </CardContent>
          </Card>

          {/* Review Actions */}
          {(canApprove || canIssue || canCancel) && po.status !== "cancelled" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-3">
                <PoReviewActions
                  poId={po.id}
                  poNumber={po.po_number}
                  status={po.status}
                  canApprove={canApprove}
                  canIssue={canIssue}
                  canCancel={canCancel}
                />
                {showDeliveryForm && po.po_items && (
                  <DeliveryForm
                    poId={po.id}
                    poNumber={po.po_number}
                    items={po.po_items}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Deliveries */}
          {po.deliveries && po.deliveries.length > 0 && (
            <PoDeliveriesSection deliveries={po.deliveries} />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workflow</CardTitle>
            </CardHeader>
            <CardContent>
              <ApprovalStepper steps={steps} orientation="vertical" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">PO Amount</span>
                <span className="font-semibold">{formatPeso(parseFloat(po.total_amount))}</span>
              </div>
              {po.procurement?.contract_amount && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Contract Amount</span>
                  <span>{formatPeso(parseFloat(po.procurement.contract_amount))}</span>
                </div>
              )}
              {po.procurement?.abc_amount && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ABC</span>
                  <span>{formatPeso(parseFloat(po.procurement.abc_amount))}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Method</span>
                <Badge variant="outline" className="capitalize">
                  {po.procurement?.procurement_method?.replace(/_/g, " ") ?? "—"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{format(new Date(po.created_at), "MMM d, yyyy")}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
