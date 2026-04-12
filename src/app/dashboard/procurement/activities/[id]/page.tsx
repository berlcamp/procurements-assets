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
import { PhilgepsReferenceDialog } from "@/components/procurement/philgeps-reference-dialog"
import { BacResolutionDialog } from "@/components/procurement/bac-resolution-dialog"
import { ProcurementDocumentUpload } from "@/components/procurement/procurement-document-upload"
import { PerformanceSecurityDialog } from "@/components/procurement/performance-security-dialog"
import { ProcurementDocumentsList } from "@/components/procurement/procurement-documents-list"
import { SupplierAssignmentDialog } from "@/components/procurement/supplier-assignment-dialog"
import { MethodSpecificFields } from "@/components/procurement/method-specific-fields"
import {
  getProcurementActivityById,
  getProcurementStages,
  getProcurementUserPermissions,
  getBidsForProcurement,
  getMyBidConfirmationStatus,
  getProcurementConfirmationProgress,
  getMyDivisionId,
} from "@/lib/actions/procurement-activities"
import { getPoForProcurement } from "@/lib/actions/purchase-orders"
import { PoCreateDialog } from "@/components/procurement/po-create-dialog"
import { PROCUREMENT_METHOD_LABELS } from "@/lib/schemas/procurement"
import { format } from "date-fns"

export default async function ProcurementActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [activity, stages, permissions, bids, myConfirmation, quorum, divisionId, existingPo] = await Promise.all([
    getProcurementActivityById(id),
    getProcurementStages(id),
    getProcurementUserPermissions(id),
    getBidsForProcurement(id),
    getMyBidConfirmationStatus(id),
    getProcurementConfirmationProgress(id),
    getMyDivisionId(),
    getPoForProcurement(id),
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

  const isCompetitiveBidding = activity.procurement_method === "competitive_bidding"
  const isCompetitiveMethod = ["svp", "shopping", "competitive_bidding"].includes(activity.procurement_method)
  const minBidsRequired = isCompetitiveBidding ? 2 : 3

  const EVAL_STAGES = [
    "quotations_received", "canvass_received",
    "evaluation", "comparison", "abstract_prepared",
    "preliminary_examination", "technical_evaluation", "financial_evaluation",
    "post_qualification", "bac_resolution",
  ]
  const hasAction =
    (permissions.canAdvance && activity.status === "active") ||
    (permissions.canRecordBid && activity.status === "active") ||
    (permissions.canEvaluate && EVAL_STAGES.includes(activity.current_stage)) ||
    (permissions.canConfirm  && EVAL_STAGES.includes(activity.current_stage)) ||
    (permissions.canRecommendAward && ["evaluation", "abstract_prepared", "comparison", "post_qualification", "bac_resolution"].includes(activity.current_stage)) ||
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

      {/* BAC resolution banner — award must be selected via Bids page */}
      {activity.status === "active" &&
        activity.current_stage === "bac_resolution" &&
        !activity.awarded_supplier_id && (
          <Card className="border-blue-300 bg-blue-50">
            <CardContent className="flex items-start justify-between gap-3 py-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-900">BAC Resolution — Select Winning Bid</p>
                <p className="text-xs text-blue-800">
                  The BAC must select the Lowest Calculated Responsive Bid (LCRB) on the Bids page before the resolution can advance to Award Recommended.
                </p>
              </div>
              <Button size="sm" nativeButton={false} render={<Link href={`/dashboard/procurement/activities/${id}/bids`} />}>
                Go to Bids
              </Button>
            </CardContent>
          </Card>
      )}

      {/* Awaiting SDS approval — visible to non-approvers at award_recommended */}
      {activity.status === "active" &&
        activity.current_stage === "award_recommended" &&
        !permissions.canApproveAward && (
          <Card className="border-blue-300 bg-blue-50">
            <CardContent className="py-4">
              <p className="text-sm font-medium text-blue-900">
                Awaiting Schools Division Superintendent Approval
              </p>
              <p className="text-xs text-blue-800 mt-1">
                The BAC has recommended {activity.supplier?.name ?? "a supplier"} for award.
                The <strong>Schools Division Superintendent</strong> (Head of Procuring
                Entity under RA 12009) must now log in and click <strong>Approve
                Award</strong> to advance to NOA Issued. Until then, no further action
                is required from the BAC Secretariat or BAC members.
              </p>
            </CardContent>
          </Card>
      )}

      {/* Secretariat: draft evaluation */}
      {activity.status === "active" &&
        permissions.canEvaluate &&
        EVAL_STAGES.includes(activity.current_stage) && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="flex items-start justify-between gap-3 py-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-900">
                  BAC Secretariat — Draft the Evaluation
                </p>
                <p className="text-xs text-amber-800">
                  Enter responsiveness, eligibility, compliance, and any score/remarks
                  for each bid. BAC members ({quorum.confirmedMembers}/{quorum.required} confirmed)
                  will then confirm your draft. Editing after confirmations invalidates them.
                </p>
              </div>
              <Button size="sm" nativeButton={false} render={<Link href={`/dashboard/procurement/activities/${id}/evaluation`} />}>
                Open Draft
              </Button>
            </CardContent>
          </Card>
      )}

      {/* BAC voting member: confirm evaluation */}
      {activity.status === "active" &&
        permissions.canConfirm &&
        !permissions.canEvaluate &&
        EVAL_STAGES.includes(activity.current_stage) && (() => {
          // Stale rows in history don't override a fresh confirmed row.
          // Only show "please re-confirm" when the user has no current
          // confirmed row AND at least one stale row exists.
          const confirmed       = myConfirmation.hasConfirmed
          const needsReconfirm  = !confirmed && myConfirmation.hasStaleConfirmation
          const quorumSuffix    = quorum.required > 0
            ? `${quorum.confirmedMembers} of ${quorum.required} BAC members confirmed.`
            : `${quorum.confirmedMembers} confirmations recorded.`

          return (
            <Card className={confirmed ? "border-green-300 bg-green-50" : "border-blue-300 bg-blue-50"}>
              <CardContent className="flex items-start justify-between gap-3 py-4">
                <div className="space-y-1">
                  <p className={confirmed ? "text-sm font-medium text-green-900" : "text-sm font-medium text-blue-900"}>
                    {confirmed
                      ? "You have already confirmed this evaluation"
                      : needsReconfirm
                        ? "Evaluation Revised — Please Re-confirm"
                        : "Confirm BAC Evaluation"}
                  </p>
                  <p className={confirmed ? "text-xs text-green-800" : "text-xs text-blue-800"}>
                    {confirmed
                      ? `Your confirmation is on file. ${quorumSuffix}`
                      : needsReconfirm
                        ? "The BAC Secretariat updated the evaluation after your previous confirmation. Please review and re-confirm."
                        : `Review the Secretariat's evaluation draft and click Confirm. ${quorumSuffix}`}
                  </p>
                </div>
                <Button size="sm" nativeButton={false} render={<Link href={`/dashboard/procurement/activities/${id}/evaluation`} />}>
                  {confirmed ? "View Evaluation" : "Open to Confirm"}
                </Button>
              </CardContent>
            </Card>
          )
        })()}

      {/* BAC Resolution upload — shown while at bac_resolution stage for the Secretariat */}
      {activity.status === "active" &&
        activity.current_stage === "bac_resolution" &&
        permissions.canUploadResolution &&
        divisionId && (
          <Card className={activity.bac_resolution_file_url ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}>
            <CardContent className="flex items-start justify-between gap-3 py-4">
              <div className="space-y-1">
                <p className={activity.bac_resolution_file_url ? "text-sm font-medium text-green-900" : "text-sm font-medium text-amber-900"}>
                  {activity.bac_resolution_file_url
                    ? `BAC Resolution on file${activity.bac_resolution_number ? ": " + activity.bac_resolution_number : ""}`
                    : "BAC Resolution required"}
                </p>
                <p className={activity.bac_resolution_file_url ? "text-xs text-green-800" : "text-xs text-amber-800"}>
                  {activity.bac_resolution_file_url
                    ? `${activity.bac_resolution_date ? "Dated " + activity.bac_resolution_date + ". " : ""}Required before advancing to Award Recommended.`
                    : "Upload the signed BAC Resolution document before advancing to Award Recommended."}
                </p>
              </div>
              <BacResolutionDialog
                procurementId={activity.id}
                divisionId={divisionId}
                currentNumber={activity.bac_resolution_number}
                currentDate={activity.bac_resolution_date}
                currentFileUrl={activity.bac_resolution_file_url}
              />
            </CardContent>
          </Card>
      )}

      {/* Notice of Award upload — at noa_issued stage */}
      {activity.status === "active" &&
        activity.current_stage === "noa_issued" &&
        permissions.canUploadResolution &&
        divisionId && (
          <Card className={activity.noa_file_url ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}>
            <CardContent className="flex items-start justify-between gap-3 py-4">
              <div className="space-y-1">
                <p className={activity.noa_file_url ? "text-sm font-medium text-green-900" : "text-sm font-medium text-amber-900"}>
                  {activity.noa_file_url ? "Notice of Award on file" : "Notice of Award required"}
                </p>
                <p className={activity.noa_file_url ? "text-xs text-green-800" : "text-xs text-amber-800"}>
                  Upload the signed Notice of Award document. Required before advancing to Contract Signing.
                </p>
              </div>
              <ProcurementDocumentUpload
                procurementId={activity.id}
                divisionId={divisionId}
                docType="noa"
                currentPath={activity.noa_file_url}
                variant="compact"
              />
            </CardContent>
          </Card>
      )}

      {/* Performance Security — required at noa_issued before advancing to contract_signing */}
      {activity.status === "active" &&
        (activity.current_stage === "noa_issued" || activity.current_stage === "contract_signing") &&
        activity.performance_security_required &&
        permissions.canManage && (() => {
          const isRecorded = !!activity.performance_security_received_at
          return (
            <Card className={isRecorded ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}>
              <CardContent className="flex items-start justify-between gap-3 py-4">
                <div className="space-y-1">
                  <p className={isRecorded ? "text-sm font-medium text-green-900" : "text-sm font-medium text-amber-900"}>
                    {isRecorded ? "Performance Security on file" : "Performance Security required"}
                  </p>
                  <p className={isRecorded ? "text-xs text-green-800" : "text-xs text-amber-800"}>
                    {isRecorded
                      ? `${activity.performance_security_form?.replace(/_/g, " ")} · ${activity.performance_security_reference} · ₱${parseFloat(activity.performance_security_amount ?? "0").toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : "RA 12009 IRR §39 requires the winning bidder to post performance security (typically 5% of contract amount in cash, or 30% as a surety bond) before the contract is signed. Record it here once received."}
                  </p>
                </div>
                <PerformanceSecurityDialog
                  procurementId={activity.id}
                  suggestedAmount={activity.performance_security_amount}
                  isRecorded={isRecorded}
                  currentForm={activity.performance_security_form}
                  currentReference={activity.performance_security_reference}
                  currentAmount={activity.performance_security_amount}
                />
              </CardContent>
            </Card>
          )
        })()}

      {/* Signed Contract upload — at contract_signing stage */}
      {activity.status === "active" &&
        activity.current_stage === "contract_signing" &&
        permissions.canUploadResolution &&
        divisionId && (
          <Card className={activity.signed_contract_file_url ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}>
            <CardContent className="flex items-start justify-between gap-3 py-4">
              <div className="space-y-1">
                <p className={activity.signed_contract_file_url ? "text-sm font-medium text-green-900" : "text-sm font-medium text-amber-900"}>
                  {activity.signed_contract_file_url ? "Signed Contract on file" : "Signed Contract required"}
                </p>
                <p className={activity.signed_contract_file_url ? "text-xs text-green-800" : "text-xs text-amber-800"}>
                  Upload the fully signed contract. Required before advancing to NTP Issued.
                </p>
              </div>
              <ProcurementDocumentUpload
                procurementId={activity.id}
                divisionId={divisionId}
                docType="signed_contract"
                currentPath={activity.signed_contract_file_url}
                variant="compact"
              />
            </CardContent>
          </Card>
      )}

      {/* Notice to Proceed upload — at ntp_issued stage */}
      {activity.status === "active" &&
        activity.current_stage === "ntp_issued" &&
        permissions.canUploadResolution &&
        divisionId && (
          <Card className={activity.ntp_file_url ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}>
            <CardContent className="flex items-start justify-between gap-3 py-4">
              <div className="space-y-1">
                <p className={activity.ntp_file_url ? "text-sm font-medium text-green-900" : "text-sm font-medium text-amber-900"}>
                  {activity.ntp_file_url ? "Notice to Proceed on file" : "Notice to Proceed required"}
                </p>
                <p className={activity.ntp_file_url ? "text-xs text-green-800" : "text-xs text-amber-800"}>
                  Upload the signed Notice to Proceed. Required before the procurement can be marked as Completed.
                </p>
              </div>
              <ProcurementDocumentUpload
                procurementId={activity.id}
                divisionId={divisionId}
                docType="ntp"
                currentPath={activity.ntp_file_url}
                variant="compact"
              />
            </CardContent>
          </Card>
      )}

      {/* Purchase Order section */}
      {activity.awarded_supplier_id && !existingPo && permissions.canAdvance && (
          <Card className="border-blue-300 bg-blue-50">
            <CardContent className="flex items-start justify-between gap-3 py-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-900">Ready for Purchase Order</p>
                <p className="text-xs text-blue-800">
                  This procurement has been awarded. Create a Purchase Order to proceed with delivery.
                </p>
              </div>
              <PoCreateDialog
                procurementId={activity.id}
                procurementNumber={activity.procurement_number}
                supplierName={activity.supplier?.name ?? "Unknown supplier"}
                contractAmount={activity.contract_amount}
                abcAmount={activity.abc_amount}
              />
            </CardContent>
          </Card>
      )}

      {existingPo && (
          <Card className="border-green-300 bg-green-50">
            <CardContent className="flex items-start justify-between gap-3 py-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-green-900">
                  Purchase Order: {existingPo.po_number}
                </p>
                <p className="text-xs text-green-800">
                  Status: {existingPo.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                </p>
              </div>
              <Button size="sm" nativeButton={false} render={<Link href={`/dashboard/procurement/purchase-orders/${existingPo.id}`} />}>
                View PO
              </Button>
            </CardContent>
          </Card>
      )}

      {/* No-bid-selected at award_recommended banner */}
      {activity.status === "active" &&
        activity.current_stage === "award_recommended" &&
        !activity.awarded_supplier_id && (
          <Card className="border-red-300 bg-red-50">
            <CardContent className="flex items-start justify-between gap-3 py-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-900">No bid has been recommended yet</p>
                <p className="text-xs text-red-800">
                  This procurement is at the &quot;Award Recommended&quot; stage but no supplier has been
                  selected. The BAC Secretariat must go to the Bids page and click <strong>Recommend Award</strong> on the winning bid before the Schools Division Superintendent can approve.
                </p>
              </div>
              <Button size="sm" nativeButton={false} render={<Link href={`/dashboard/procurement/activities/${id}/bids`} />}>
                Go to Bids
              </Button>
            </CardContent>
          </Card>
      )}

      {/* PhilGEPS reference required banner */}
      {!activity.philgeps_reference &&
        activity.status === "active" &&
        ["created", "rfq_preparation", "canvass_preparation", "bid_document_preparation", "pre_procurement_conference"].includes(activity.current_stage) &&
        permissions.canManage && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="flex items-start justify-between gap-3 py-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-900">
                  PhilGEPS reference required
                </p>
                <p className="text-xs text-amber-800">
                  RA 12009 requires opportunities to be published on PhilGEPS before the RFQ/canvass can be sent.
                  Set the reference number now to unblock the next stage.
                </p>
              </div>
              <PhilgepsReferenceDialog
                procurementId={activity.id}
                currentReference={activity.philgeps_reference}
              />
            </CardContent>
          </Card>
        )}

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
                {pr.procurement_mode && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Procurement Mode</span>
                    <span className="capitalize">{pr.procurement_mode.replace(/_/g, " ")}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Estimated Cost</span>
                  <AmountDisplay amount={pr.total_estimated_cost} className="font-semibold" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bid / Quotation Summary — only for competitive methods (SVP, Shopping, CB) */}
          {isCompetitiveMethod && (
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
                {bids.length < minBidsRequired && activity.status === "active" && (
                  <p className="text-xs text-amber-600 pt-1">
                    Minimum {minBidsRequired} bids required before award. {minBidsRequired - bids.length} more needed.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Supplier Assignment — for non-competitive methods */}
          {!isCompetitiveMethod && activity.status === "active" && permissions.canManage && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Supplier</CardTitle>
                  <SupplierAssignmentDialog
                    procurementId={activity.id}
                    abcAmount={activity.abc_amount}
                    currentSupplierId={activity.awarded_supplier_id}
                    currentSupplierName={activity.supplier?.name ?? null}
                    currentContractAmount={activity.contract_amount}
                  />
                </div>
              </CardHeader>
              <CardContent className="text-sm">
                {activity.awarded_supplier_id ? (
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Assigned Supplier</span>
                      <span className="font-medium">{activity.supplier?.name ?? "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Contract Amount</span>
                      <AmountDisplay amount={activity.contract_amount ?? "0"} className="font-semibold" />
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs">No supplier assigned yet. Use the button above.</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Method-Specific Fields — for alternative methods */}
          {!isCompetitiveMethod && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Method Details</CardTitle>
              </CardHeader>
              <CardContent>
                <MethodSpecificFields
                  activity={activity}
                  canEdit={permissions.canManage && activity.status === "active"}
                />
              </CardContent>
            </Card>
          )}

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
                  canConfirm={permissions.canConfirm}
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
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">PhilGEPS Ref</span>
                {activity.philgeps_reference ? (
                  <span className="flex items-center gap-1">
                    <span className="font-mono text-xs">{activity.philgeps_reference}</span>
                    {permissions.canManage && (
                      <PhilgepsReferenceDialog
                        procurementId={activity.id}
                        currentReference={activity.philgeps_reference}
                        variant="icon"
                      />
                    )}
                  </span>
                ) : permissions.canManage ? (
                  <PhilgepsReferenceDialog
                    procurementId={activity.id}
                    currentReference={null}
                    variant="icon"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              {activity.submission_deadline && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Submission Deadline</span>
                  <span className={
                    new Date(activity.submission_deadline) > new Date()
                      ? "text-amber-700 text-xs"
                      : "text-green-700 text-xs"
                  }>
                    {format(new Date(activity.submission_deadline), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
              )}
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

          {/* Documents — all uploaded files for this procurement, downloadable */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <ProcurementDocumentsList
                documents={[
                  {
                    key: "bac_resolution",
                    label: activity.bac_resolution_number
                      ? `BAC Resolution — ${activity.bac_resolution_number}`
                      : "BAC Resolution",
                    path: activity.bac_resolution_file_url,
                    uploadedAt: activity.bac_resolution_uploaded_at,
                    meta: activity.bac_resolution_date
                      ? `Dated ${activity.bac_resolution_date}`
                      : null,
                  },
                  {
                    key: "noa",
                    label: "Notice of Award",
                    path: activity.noa_file_url,
                    uploadedAt: activity.noa_issued_at,
                    meta: null,
                  },
                  {
                    key: "signed_contract",
                    label: "Signed Contract",
                    path: activity.signed_contract_file_url,
                    uploadedAt: activity.contract_signed_at,
                    meta: null,
                  },
                  {
                    key: "ntp",
                    label: "Notice to Proceed",
                    path: activity.ntp_file_url,
                    uploadedAt: activity.ntp_issued_at,
                    meta: null,
                  },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
