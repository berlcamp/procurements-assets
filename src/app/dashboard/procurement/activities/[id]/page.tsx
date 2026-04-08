import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { ApprovalStepper, buildProcurementSteps } from "@/components/shared/approval-stepper"
import { ProcurementReviewActions } from "@/components/procurement/procurement-review-actions"
import {
  getProcurementActivityById,
  getProcurementStages,
  getProcurementUserPermissions,
  getBidsForProcurement,
} from "@/lib/actions/procurement-activities"
import { PROCUREMENT_METHOD_LABELS } from "@/lib/schemas/procurement"
import { format } from "date-fns"

export default async function ProcurementActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [activity, stages, permissions, bids] = await Promise.all([
    getProcurementActivityById(id),
    getProcurementStages(id),
    getProcurementUserPermissions(id),
    getBidsForProcurement(id),
  ])

  if (!activity) notFound()

  const pr = activity.purchase_request
  const responsiveBids = bids.filter(b => b.is_responsive && b.is_eligible && b.is_compliant)
  const awardedBid = bids.find(b => b.status === "awarded")

  const workflowSteps = buildProcurementSteps(
    activity.procurement_method,
    activity.current_stage,
    stages.map(s => ({
      stage: s.stage,
      status: s.status,
      completed_at: s.completed_at,
      completed_by: s.completed_by,
      notes: s.notes,
    }))
  )

  const hasAction =
    (permissions.canAdvance && activity.status === "active") ||
    (permissions.canRecordBid && activity.status === "active") ||
    (permissions.canEvaluate && ["quotations_received", "canvass_received", "evaluation", "comparison"].includes(activity.current_stage)) ||
    (permissions.canRecommendAward && ["evaluation", "abstract_prepared", "comparison"].includes(activity.current_stage)) ||
    (permissions.canApproveAward && activity.current_stage === "award_recommended") ||
    (permissions.canFail && activity.status === "active")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold font-mono">{activity.procurement_number}</h1>
            <StatusBadge status={activity.procurement_method} />
            <StatusBadge status={activity.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {activity.office?.name} · FY {activity.fiscal_year?.year} ·{" "}
            {PROCUREMENT_METHOD_LABELS[activity.procurement_method] ?? activity.procurement_method}
          </p>
        </div>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard/procurement/activities" />}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          {/* PR Details */}
          {pr && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Purchase Request</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">PR Number</span>
                  <Link href={`/dashboard/procurement/purchase-requests/${pr.id}`} className="font-mono text-primary hover:underline">
                    {pr.pr_number}
                  </Link>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Purpose</span>
                  <span className="text-right max-w-xs">{pr.purpose}</span>
                </div>
                {pr.requester && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Requested By</span>
                    <span>{pr.requester.first_name} {pr.requester.last_name}</span>
                  </div>
                )}
                {pr.app_item && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">APP Item</span>
                    <span className="text-right max-w-xs truncate">{pr.app_item.general_description}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Estimated Cost</span>
                  <AmountDisplay amount={pr.total_estimated_cost} className="font-semibold" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bid / Quotation Summary */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Bids / Quotations</CardTitle>
                <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/dashboard/procurement/activities/${id}/bids`} />}>
                  Manage Bids
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Bids</span>
                <span className="font-medium">{bids.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Responsive</span>
                <span className="font-medium">{responsiveBids.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Evaluated</span>
                <span className="font-medium">{bids.filter(b => b.status === "evaluated" || b.status === "awarded").length}</span>
              </div>
              {bids.length < 3 && activity.status === "active" && (
                <p className="text-xs text-amber-600 pt-1">
                  Minimum 3 bids required before award. {3 - bids.length} more needed.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Award Details (shown when awarded) */}
          {activity.awarded_supplier_id && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Award Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Awarded Supplier</span>
                  <span className="font-medium">{activity.supplier?.name ?? "—"}</span>
                </div>
                {activity.supplier?.tin && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">TIN</span>
                    <span className="font-mono text-xs">{activity.supplier.tin}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Contract Amount</span>
                  <AmountDisplay amount={activity.contract_amount ?? "0"} className="font-semibold" />
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ABC Amount</span>
                  <AmountDisplay amount={activity.abc_amount} />
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Savings</span>
                  <AmountDisplay amount={activity.savings_amount ?? "0"} className="text-green-700 font-medium" />
                </div>
                {activity.philgeps_reference && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PhilGEPS Ref</span>
                    <span className="font-mono text-xs">{activity.philgeps_reference}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Failure Details */}
          {activity.status === "failed" && activity.failure_reason && (
            <Card className="border-red-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-red-700">Procurement Failed</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>{activity.failure_reason}</p>
                {activity.failure_count > 1 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Failed {activity.failure_count} time(s)
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Review Actions */}
          {hasAction && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Your Action</CardTitle>
              </CardHeader>
              <CardContent>
                <ProcurementReviewActions
                  procurementId={activity.id}
                  procurementMethod={activity.procurement_method}
                  currentStage={activity.current_stage}
                  status={activity.status}
                  bidsCount={bids.length}
                  responsiveBidsCount={responsiveBids.length}
                  awardedBidId={awardedBid?.id ?? null}
                  canAdvance={permissions.canAdvance}
                  canRecordBid={permissions.canRecordBid}
                  canEvaluate={permissions.canEvaluate}
                  canRecommendAward={permissions.canRecommendAward}
                  canApproveAward={permissions.canApproveAward}
                  canFail={permissions.canFail}
                />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Stage Tracker */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Workflow Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <ApprovalStepper steps={workflowSteps} orientation="vertical" />
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Method</span>
                <span className="font-medium">
                  {PROCUREMENT_METHOD_LABELS[activity.procurement_method] ?? activity.procurement_method}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Office</span>
                <span>{activity.office?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fiscal Year</span>
                <span>{activity.fiscal_year?.year}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">ABC Amount</span>
                <AmountDisplay amount={activity.abc_amount} className="font-semibold" />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bids</span>
                <span>{bids.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Stage</span>
                <StatusBadge status={activity.current_stage} />
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{format(new Date(activity.created_at), "MMM d, yyyy")}</span>
              </div>
              {activity.updated_at !== activity.created_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Updated</span>
                  <span>{format(new Date(activity.updated_at), "MMM d, yyyy")}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
