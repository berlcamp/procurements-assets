"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import {
  approvePurchaseOrder,
  issuePurchaseOrder,
  cancelPurchaseOrder,
} from "@/lib/actions/purchase-orders"
import type { PoStatus } from "@/types/database"

type ActionType = "approve" | "issue" | "cancel" | null

interface PoReviewActionsProps {
  poId: string
  poNumber: string
  status: PoStatus
  canApprove: boolean
  canIssue: boolean
  canCancel: boolean
}

export function PoReviewActions({
  poId,
  poNumber,
  status,
  canApprove,
  canIssue,
  canCancel,
}: PoReviewActionsProps) {
  const router = useRouter()
  const [action, setAction] = useState<ActionType>(null)
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)

  const showApprove = status === "draft" && canApprove
  const showIssue = status === "approved" && canIssue
  const showCancel = ["draft", "approved"].includes(status) && canCancel

  if (!showApprove && !showIssue && !showCancel) return null

  async function handleSubmit() {
    setLoading(true)
    let result: { error: string | null }

    switch (action) {
      case "approve":
        result = await approvePurchaseOrder(poId, { remarks: notes || null })
        break
      case "issue":
        result = await issuePurchaseOrder(poId)
        break
      case "cancel":
        if (notes.length < 5) {
          toast.error("Cancellation reason must be at least 5 characters")
          setLoading(false)
          return
        }
        result = await cancelPurchaseOrder(poId, notes)
        break
      default:
        setLoading(false)
        return
    }

    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    const labels: Record<string, string> = {
      approve: "approved",
      issue: "issued",
      cancel: "cancelled",
    }
    toast.success(`${poNumber} has been ${labels[action!]}`)
    setAction(null)
    setNotes("")
    router.refresh()
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {showApprove && (
          <Button onClick={() => setAction("approve")}>
            Approve PO
          </Button>
        )}
        {showIssue && (
          <Button onClick={() => setAction("issue")}>
            Issue to Supplier
          </Button>
        )}
        {showCancel && (
          <Button variant="destructive" onClick={() => setAction("cancel")}>
            Cancel PO
          </Button>
        )}
      </div>

      <Dialog open={action !== null} onOpenChange={open => { if (!open) setAction(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "approve" && "Approve Purchase Order"}
              {action === "issue" && "Issue Purchase Order"}
              {action === "cancel" && "Cancel Purchase Order"}
            </DialogTitle>
            <DialogDescription>
              {action === "approve" && `Approve ${poNumber} for issuance to the supplier.`}
              {action === "issue" && `Mark ${poNumber} as issued to the supplier.`}
              {action === "cancel" && `Cancel ${poNumber}. This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>

          {(action === "approve" || action === "cancel") && (
            <div className="space-y-2 py-2">
              <Label>{action === "cancel" ? "Reason (required)" : "Remarks (optional)"}</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={action === "cancel" ? "Reason for cancellation..." : "Optional remarks..."}
                rows={3}
              />
              {action === "cancel" && notes.length > 0 && notes.length < 5 && (
                <p className="text-xs text-destructive">At least 5 characters required</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={loading}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading}
              variant={action === "cancel" ? "destructive" : "default"}
            >
              {loading ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
