"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { useAuth } from "@/lib/hooks/use-auth"
import { Forbidden } from "@/components/shared/forbidden"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import {
  ArrowLeft,
  Loader2,
  Send,
  XCircle,
  ExternalLink,
} from "lucide-react"
import { getRequestById, submitRequest, cancelRequest } from "@/lib/actions/requests"
import {
  ApprovalStepper,
  buildRequestSteps,
} from "@/components/shared/approval-stepper"
import { RequestReviewActions } from "@/components/requests/request-review-actions"
import { RequestFulfillment } from "@/components/requests/request-fulfillment"
import {
  REQUEST_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
  URGENCY_LABELS,
  FULFILLMENT_TYPE_LABELS,
} from "@/lib/schemas/request"
import type { RequestWithDetails } from "@/types/database"

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "fulfilled": return "default"
    case "rejected": case "cancelled": return "destructive"
    case "submitted": case "supervisor_approved": return "secondary"
    default: return "outline"
  }
}

export default function RequestDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { can, canAny, loading: permsLoading } = usePermissions()

  const [request, setRequest] = useState<RequestWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  const id = params.id as string

  const loadRequest = useCallback(async () => {
    const data = await getRequestById(id)
    setRequest(data)
    setLoading(false)
  }, [id])

  useEffect(() => {
    loadRequest()
  }, [loadRequest])

  if (authLoading || permsLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!canAny("request.create", "request.approve", "request.process")) {
    return <Forbidden message="You do not have permission to view requests." />
  }

  if (!request) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Request not found.</p>
        <Button variant="link" nativeButton={false} render={<Link href="/dashboard/requests" />} className="mt-2">
          Back to Requests
        </Button>
      </div>
    )
  }

  const isOwner = user?.id === request.requested_by
  const canApprove = can("request.approve")
  const canProcess = can("request.process")
  const items = request.request_items ?? []

  const steps = buildRequestSteps(request.status, {
    supervisor_approved_at: request.supervisor_approved_at,
    supervisor_remarks: request.supervisor_remarks,
    processed_at: request.processed_at,
    rejection_reason: request.rejection_reason,
  })

  async function handleSubmit() {
    setActionLoading(true)
    const result = await submitRequest(request!.id)
    setActionLoading(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Request submitted for approval")
      loadRequest()
    }
  }

  async function handleCancel() {
    setActionLoading(true)
    const result = await cancelRequest(request!.id)
    setActionLoading(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Request cancelled")
      loadRequest()
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard/requests" />} className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Requests
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{request.request_number}</h1>
            <Badge variant={statusVariant(request.status)}>
              {REQUEST_STATUS_LABELS[request.status] ?? request.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {REQUEST_TYPE_LABELS[request.request_type]} &middot; {request.office?.name ?? "—"} &middot;{" "}
            <span className="font-medium">{URGENCY_LABELS[request.urgency]}</span> priority
          </p>
        </div>

        {/* Owner actions for draft */}
        {isOwner && request.status === "draft" && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCancel} disabled={actionLoading}>
              <XCircle className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={actionLoading}>
              <Send className="h-4 w-4 mr-1" />
              {actionLoading ? "Submitting..." : "Submit"}
            </Button>
          </div>
        )}

        {/* Owner cancel for submitted */}
        {isOwner && request.status === "submitted" && (
          <Button variant="outline" onClick={handleCancel} disabled={actionLoading}>
            <XCircle className="h-4 w-4 mr-1" />
            Cancel Request
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Request Info */}
          <Card>
            <CardHeader>
              <CardTitle>Request Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Requester</dt>
                  <dd className="font-medium">
                    {request.requested_by_profile
                      ? `${request.requested_by_profile.first_name} ${request.requested_by_profile.last_name}`
                      : "—"}
                    {request.requested_by_profile?.position && (
                      <span className="text-muted-foreground font-normal"> — {request.requested_by_profile.position}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Date Created</dt>
                  <dd className="font-medium">{new Date(request.created_at).toLocaleDateString()}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Purpose</dt>
                  <dd className="font-medium">{request.purpose}</dd>
                </div>
                {request.supervisor_profile && (
                  <div>
                    <dt className="text-muted-foreground">Supervisor</dt>
                    <dd className="font-medium">
                      {request.supervisor_profile.first_name} {request.supervisor_profile.last_name}
                    </dd>
                  </div>
                )}
                {request.supervisor_remarks && (
                  <div>
                    <dt className="text-muted-foreground">Supervisor Remarks</dt>
                    <dd className="italic">{request.supervisor_remarks}</dd>
                  </div>
                )}
                {request.fulfillment_type && (
                  <div>
                    <dt className="text-muted-foreground">Fulfillment</dt>
                    <dd className="font-medium">{FULFILLMENT_TYPE_LABELS[request.fulfillment_type]}</dd>
                  </div>
                )}
                {request.processed_by_profile && (
                  <div>
                    <dt className="text-muted-foreground">Processed By</dt>
                    <dd className="font-medium">
                      {request.processed_by_profile.first_name} {request.processed_by_profile.last_name}
                    </dd>
                  </div>
                )}
                {request.rejection_reason && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground text-destructive">Rejection Reason</dt>
                    <dd className="font-medium text-destructive">{request.rejection_reason}</dd>
                  </div>
                )}
                {request.linked_pr && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Linked Purchase Request</dt>
                    <dd>
                      <Link
                        href={`/dashboard/procurement/purchase-requests/${request.linked_pr.id}`}
                        className="text-blue-600 hover:underline inline-flex items-center gap-1"
                      >
                        {request.linked_pr.pr_number}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle>Items ({items.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Requested</TableHead>
                    <TableHead className="text-right">Issued</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(item => {
                    const requested = parseFloat(item.quantity_requested)
                    const issued = parseFloat(item.quantity_issued)
                    const fulfilled = issued >= requested
                    const partial = issued > 0 && !fulfilled

                    return (
                      <TableRow key={item.id}>
                        <TableCell>{item.item_number}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.description}</p>
                            {item.item_catalog && (
                              <p className="text-xs text-muted-foreground">
                                {item.item_catalog.code} &middot; {item.item_catalog.category}
                              </p>
                            )}
                            {item.remarks && (
                              <p className="text-xs text-muted-foreground italic">{item.remarks}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell className="text-right">{requested}</TableCell>
                        <TableCell className="text-right">{issued}</TableCell>
                        <TableCell>
                          {fulfilled && <Badge className="bg-green-100 text-green-800">Fulfilled</Badge>}
                          {partial && <Badge className="bg-yellow-100 text-yellow-800">Partial</Badge>}
                          {!fulfilled && !partial && <Badge variant="outline">Pending</Badge>}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Approval action (supervisor) */}
          {canApprove && request.status === "submitted" && (
            <Card>
              <CardHeader>
                <CardTitle>Supervisor Action</CardTitle>
              </CardHeader>
              <CardContent>
                <RequestReviewActions
                  requestId={request.id}
                  requestNumber={request.request_number}
                  onComplete={loadRequest}
                />
              </CardContent>
            </Card>
          )}

          {/* Fulfillment panel (supply officer) */}
          {canProcess && ["supervisor_approved", "processing", "partially_fulfilled"].includes(request.status) && (
            <RequestFulfillment request={request} onComplete={loadRequest} />
          )}
        </div>

        {/* Right column — workflow stepper */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Workflow</CardTitle>
            </CardHeader>
            <CardContent>
              <ApprovalStepper steps={steps} orientation="vertical" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
