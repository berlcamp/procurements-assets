"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  submitPurchaseRequest,
  certifyBudgetAvailability,
  approvePurchaseRequest,
  returnPrToEndUser,
  cancelPurchaseRequest,
} from "@/lib/actions/procurement"
import type { PrStatus } from "@/types/database"

type PrAction =
  | "submit"
  | "certify"
  | "approve"
  | "return_to_end_user"
  | "cancel"

interface PrReviewActionsProps {
  prId: string
  prStatus: PrStatus
  totalEstimatedCost: string
  canCertify: boolean
  canApprove: boolean
  canCancel: boolean
  isOwner: boolean
}

const ACTION_LABELS: Record<PrAction, string> = {
  submit:             "Submit for Certification",
  certify:            "Certify Fund Availability",
  approve:            "Approve Purchase Request",
  return_to_end_user: "Return to End User",
  cancel:             "Cancel Purchase Request",
}

const ACTION_DESCRIPTIONS: Record<PrAction, string> = {
  submit:             "Submit this Purchase Request for budget certification by the Budget Officer.",
  certify:            "Certify that funds are available. This will create an Obligation Request (OBR) and debit the budget allocation.",
  approve:            "Approve this Purchase Request. It will be ready for procurement activities.",
  return_to_end_user: "Return this Purchase Request to the End User for revision. A reason is required.",
  cancel:             "Cancel this Purchase Request. This action cannot be undone.",
}

const REQUIRES_NOTES: Set<PrAction> = new Set(["return_to_end_user", "cancel"])

export function PrReviewActions({
  prId,
  prStatus,
  canCertify,
  canApprove,
  canCancel,
  isOwner,
}: PrReviewActionsProps) {
  const router = useRouter()
  const [action, setAction] = useState<PrAction | null>(null)
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)

  function openDialog(a: PrAction) {
    setAction(a)
    setNotes("")
  }

  function closeDialog() {
    if (loading) return
    setAction(null)
    setNotes("")
  }

  async function handleConfirm() {
    if (!action) return

    const requiresNotes = REQUIRES_NOTES.has(action)
    if (requiresNotes && notes.trim().length < 5) {
      toast.error("Please enter a reason (min 5 characters)")
      return
    }

    setLoading(true)
    let result: { error: string | null }

    try {
      switch (action) {
        case "submit":
          result = await submitPurchaseRequest(prId)
          break
        case "certify":
          result = await certifyBudgetAvailability(prId, { remarks: notes || null })
          break
        case "approve":
          result = await approvePurchaseRequest(prId, { remarks: notes || null })
          break
        case "return_to_end_user":
          result = await returnPrToEndUser(prId, { reason: notes })
          break
        case "cancel":
          result = await cancelPurchaseRequest(prId, { cancellation_reason: notes })
          break
      }

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(`${ACTION_LABELS[action]} successful`)
        closeDialog()
        router.refresh()
      }
    } finally {
      setLoading(false)
    }
  }

  const isDraft         = prStatus === "draft"
  const isSubmitted     = prStatus === "submitted"
  const isCertified     = prStatus === "budget_certified"
  const isCancellable   = !["in_procurement", "completed", "cancelled"].includes(prStatus)

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {/* End User: submit draft */}
        {isOwner && isDraft && (
          <Button onClick={() => openDialog("submit")}>
            Submit for Certification
          </Button>
        )}

        {/* Budget Officer: certify submitted */}
        {canCertify && isSubmitted && (
          <Button onClick={() => openDialog("certify")} className="bg-green-600 hover:bg-green-700">
            Certify Fund Availability
          </Button>
        )}

        {/* Return to End User (certifier or approver) */}
        {(canCertify && isSubmitted) || (canApprove && isCertified) ? (
          <Button variant="outline" onClick={() => openDialog("return_to_end_user")}>
            Return to End User
          </Button>
        ) : null}

        {/* HOPE: approve certified */}
        {canApprove && isCertified && (
          <Button onClick={() => openDialog("approve")} className="bg-green-600 hover:bg-green-700">
            Approve Purchase Request
          </Button>
        )}

        {/* Cancel */}
        {canCancel && isCancellable && !isDraft && (
          <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10"
            onClick={() => openDialog("cancel")}>
            Cancel PR
          </Button>
        )}
      </div>

      <Dialog open={!!action} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action ? ACTION_LABELS[action] : ""}</DialogTitle>
            <DialogDescription>
              {action ? ACTION_DESCRIPTIONS[action] : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="pr-action-notes">
                {action && REQUIRES_NOTES.has(action) ? "Reason *" : "Remarks (optional)"}
              </Label>
              <Textarea
                id="pr-action-notes"
                placeholder={action && REQUIRES_NOTES.has(action)
                  ? "Enter a reason (min 5 characters)..."
                  : "Add optional remarks..."}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="mt-1.5"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={loading}>
              {loading ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
