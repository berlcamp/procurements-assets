"use client"

import { useState } from "react"
import { CheckIcon, XIcon, AlertTriangleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"

interface ApprovalActionsProps {
  onApprove: (remarks?: string) => Promise<{ error: string | null }>
  onReject: (remarks?: string) => Promise<{ error: string | null }>
  requireRemarksOnReject?: boolean
  disabled?: boolean
}

export function ApprovalActions({
  onApprove,
  onReject,
  requireRemarksOnReject = true,
  disabled,
}: ApprovalActionsProps) {
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleApprove() {
    setLoading(true)
    const result = await onApprove(remarks.trim() || undefined)
    setLoading(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Approved successfully.")
      setApproveOpen(false)
      setRemarks("")
    }
  }

  async function handleReject() {
    if (requireRemarksOnReject && !remarks.trim()) {
      toast.error("Remarks are required when rejecting.")
      return
    }
    setLoading(true)
    const result = await onReject(remarks.trim() || undefined)
    setLoading(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Rejected.")
      setRejectOpen(false)
      setRemarks("")
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={disabled || loading}
          onClick={() => { setRemarks(""); setApproveOpen(true) }}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          <CheckIcon className="mr-1.5 h-3.5 w-3.5" />
          Approve
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || loading}
          onClick={() => { setRemarks(""); setRejectOpen(true) }}
          className="border-destructive text-destructive hover:bg-destructive/10"
        >
          <XIcon className="mr-1.5 h-3.5 w-3.5" />
          Reject
        </Button>
      </div>

      {/* Approve dialog */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve</DialogTitle>
            <DialogDescription>
              Confirm approval. You may add optional remarks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="approve-remarks">Remarks (optional)</Label>
            <Textarea
              id="approve-remarks"
              placeholder="Add remarks…"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={loading}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {loading ? "Approving…" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="h-4 w-4 text-destructive" />
              Reject
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. {requireRemarksOnReject && "Remarks are required."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-remarks">
              Remarks {requireRemarksOnReject && <span className="text-destructive">*</span>}
            </Label>
            <Textarea
              id="reject-remarks"
              placeholder="Explain why this is being rejected…"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={loading}>
              {loading ? "Rejecting…" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
