import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { ApprovalStepper } from "@/components/shared/approval-stepper"
import { PrItemsView } from "@/components/procurement/pr-items-table"
import { PrReviewActions } from "@/components/procurement/pr-review-actions"
import { getPurchaseRequestById, getPrUserPermissions } from "@/lib/actions/procurement"
import { format } from "date-fns"
import type { WorkflowStep } from "@/components/shared/approval-stepper"
import type { PurchaseRequestWithDetails } from "@/types/database"

function buildPrSteps(pr: PurchaseRequestWithDetails): WorkflowStep[] {
  const s = pr.status

  const done  = (id: string) => ["submitted","budget_certified","approved","in_procurement","completed"].includes(s)
    && ["draft"].includes(id)
      ? true
      : s === "submitted" && id === "draft"
        ? true
        : ["budget_certified","approved","in_procurement","completed"].includes(s) && id === "submitted"
          ? true
          : ["approved","in_procurement","completed"].includes(s) && id === "budget_certified"
            ? true
            : ["in_procurement","completed"].includes(s) && id === "approved"
              ? true
              : s === "completed" && id === "in_procurement"

  return [
    {
      id: "draft",
      label: "Draft",
      description: "PR created",
      status: s === "draft" ? "current" : done("draft") ? "completed" : "pending",
    },
    {
      id: "submitted",
      label: "Submitted",
      description: "Awaiting budget certification",
      status: s === "submitted" ? "current" : done("submitted") ? "completed" : "pending",
      timestamp: pr.requested_at ? format(new Date(pr.requested_at), "MMM d, yyyy") : undefined,
    },
    {
      id: "budget_certified",
      label: "Budget Certified",
      description: "Fund availability certified",
      status: s === "budget_certified" ? "current" : done("budget_certified") ? "completed" : "pending",
      timestamp: pr.budget_certified_at
        ? format(new Date(pr.budget_certified_at), "MMM d, yyyy")
        : undefined,
    },
    {
      id: "approved",
      label: "Approved",
      description: "Approved for procurement",
      status: ["in_procurement","completed"].includes(s) ? "completed"
        : s === "approved" ? "current"
        : s === "cancelled" ? "skipped"
        : "pending",
      timestamp: pr.approved_at ? format(new Date(pr.approved_at), "MMM d, yyyy") : undefined,
    },
    {
      id: "in_procurement",
      label: "In Procurement",
      description: "Procurement activities underway",
      status: s === "completed" ? "completed"
        : s === "in_procurement" ? "current"
        : s === "cancelled" ? "skipped"
        : "pending",
    },
  ]
}

export default async function PurchaseRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [pr, permissions] = await Promise.all([
    getPurchaseRequestById(id),
    getPrUserPermissions(id),
  ])

  if (!pr) notFound()

  const available = pr.budget_allocation
    ? (parseFloat(pr.budget_allocation.adjusted_amount) - parseFloat(pr.budget_allocation.obligated_amount))
    : null

  const hasActionableReview =
    (pr.status === "draft" && permissions.isOwner) ||
    (pr.status === "submitted" && permissions.canCertify) ||
    (pr.status === "budget_certified" && permissions.canApprove)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold font-mono">{pr.pr_number}</h1>
            <StatusBadge status={pr.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {pr.office?.name} · FY {pr.fiscal_year?.year} ·{" "}
            <AmountDisplay amount={pr.total_estimated_cost} />
          </p>
        </div>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard/procurement/purchase-requests" />}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Purpose & Details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Purpose & Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>{pr.purpose}</p>
              {pr.app_item && (
                <div>
                  <span className="text-muted-foreground">APP Item: </span>
                  <span className="font-medium">{pr.app_item.general_description}</span>
                  {pr.app_item.procurement_mode && (
                    <span className="text-muted-foreground"> · {pr.app_item.procurement_mode}</span>
                  )}
                </div>
              )}
              {pr.lot && (
                <div>
                  <span className="text-muted-foreground">Lot: </span>
                  <span>Lot {pr.lot.lot_number} — {pr.lot.lot_name}</span>
                </div>
              )}
              {pr.fund_source && (
                <div>
                  <span className="text-muted-foreground">Fund Source: </span>
                  <span>{pr.fund_source.name}</span>
                </div>
              )}
              {available !== null && (
                <div>
                  <span className="text-muted-foreground">Budget Available: </span>
                  <span className={available < 0 ? "text-red-600 font-medium" : "text-green-700 font-medium"}>
                    <AmountDisplay amount={available.toString()} />
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <PrItemsView items={pr.pr_items ?? []} />
            </CardContent>
          </Card>

          {/* Review Actions */}
          {hasActionableReview && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Your Action</CardTitle>
              </CardHeader>
              <CardContent>
                <PrReviewActions
                  prId={pr.id}
                  prStatus={pr.status}
                  totalEstimatedCost={pr.total_estimated_cost}
                  canCertify={permissions.canCertify}
                  canApprove={permissions.canApprove}
                  canCancel={permissions.canCancel}
                  isOwner={permissions.isOwner}
                />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Approval Chain */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Approval Chain</CardTitle>
            </CardHeader>
            <CardContent>
              <ApprovalStepper steps={buildPrSteps(pr)} orientation="vertical" />
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Office</span>
                <span className="font-medium">{pr.office?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fiscal Year</span>
                <span>{pr.fiscal_year?.year}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">PR Number</span>
                <span className="font-mono text-xs">{pr.pr_number}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Cost</span>
                <span className="font-semibold">
                  <AmountDisplay amount={pr.total_estimated_cost} />
                </span>
              </div>
              {pr.obr && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">OBR Number</span>
                    <span className="font-mono text-xs">{pr.obr.obr_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">OBR Status</span>
                    <StatusBadge status={pr.obr.status} />
                  </div>
                </>
              )}
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Requested</span>
                <span>{pr.requested_at ? format(new Date(pr.requested_at), "MMM d, yyyy") : "—"}</span>
              </div>
              {pr.budget_certified_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Certified</span>
                  <span>{format(new Date(pr.budget_certified_at), "MMM d, yyyy")}</span>
                </div>
              )}
              {pr.approved_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Approved</span>
                  <span>{format(new Date(pr.approved_at), "MMM d, yyyy")}</span>
                </div>
              )}
              {pr.cancellation_reason && (
                <div className="pt-1">
                  <p className="text-muted-foreground text-xs">Cancellation reason:</p>
                  <p className="text-xs">{pr.cancellation_reason}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
