"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { CheckCircle, XCircle } from "lucide-react"
import { approveRequest, rejectRequest } from "@/lib/actions/requests"

interface RequestReviewActionsProps {
  requestId: string
  requestNumber: string
  onComplete: () => void
}

export function RequestReviewActions({
  requestId,
  requestNumber,
  onComplete,
}: RequestReviewActionsProps) {
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleApprove() {
    setSubmitting(true)
    const result = await approveRequest({ request_id: requestId, remarks: remarks || null })
    setSubmitting(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Request ${requestNumber} approved`)
      setApproveOpen(false)
      setRemarks("")
      onComplete()
    }
  }

  async function handleReject() {
    if (reason.trim().length < 5) {
      toast.error("Please provide a rejection reason (at least 5 characters)")
      return
    }
    setSubmitting(true)
    const result = await rejectRequest({ request_id: requestId, reason })
    setSubmitting(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Request ${requestNumber} rejected`)
      setRejectOpen(false)
      setReason("")
      onComplete()
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <Button onClick={() => setApproveOpen(true)} className="gap-1">
          <CheckCircle className="h-4 w-4" />
          Approve
        </Button>
        <Button variant="destructive" onClick={() => setRejectOpen(true)} className="gap-1">
          <XCircle className="h-4 w-4" />
          Reject
        </Button>
      </div>

      {/* Approve Dialog */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Request</DialogTitle>
            <DialogDescription>
              Approve request {requestNumber}. The request will be forwarded to the supply officer for processing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Remarks (optional)</Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional remarks or notes..."
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setApproveOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleApprove} disabled={submitting}>
                {submitting ? "Approving..." : "Confirm Approval"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
            <DialogDescription>
              Reject request {requestNumber}. The requester will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Reason for Rejection *</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this request is being rejected..."
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleReject} disabled={submitting || reason.trim().length < 5}>
                {submitting ? "Rejecting..." : "Confirm Rejection"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
