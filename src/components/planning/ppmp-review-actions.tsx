"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  chiefReviewPpmp, certifyPpmpBudget, approvePpmp, returnPpmp,
} from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { CheckIcon, RotateCcwIcon } from "lucide-react"
import type { PpmpStatus } from "@/types/database"

type PpmpAction = "chief_forward" | "chief_return" | "certify" | "approve" | "return_to_end_user" | "return_to_chief" | "return_to_budget"

interface PpmpReviewActionsProps {
  ppmpId: string
  ppmpStatus: PpmpStatus
  /** Permissions the current user holds — passed from server */
  canChiefReview: boolean
  canCertify: boolean
  canApprove: boolean
  canReturn: boolean
}

export function PpmpReviewActions({
  ppmpId, ppmpStatus,
  canChiefReview, canCertify, canApprove, canReturn,
}: PpmpReviewActionsProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<PpmpAction | null>(null)
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)

  function openDialog(a: PpmpAction) {
    setAction(a)
    setNotes("")
    setOpen(true)
  }

  async function handleConfirm() {
    if (!action) return
    setLoading(true)
    let result: { error: string | null }

    if (action === "chief_forward") {
      result = await chiefReviewPpmp(ppmpId, { action: "forward", notes })
    } else if (action === "chief_return") {
      result = await chiefReviewPpmp(ppmpId, { action: "return", notes })
    } else if (action === "certify") {
      result = await certifyPpmpBudget(ppmpId, { notes })
    } else if (action === "approve") {
      result = await approvePpmp(ppmpId, { notes })
    } else {
      const stepMap: Record<string, "to_end_user" | "to_chief" | "to_budget"> = {
        return_to_end_user: "to_end_user",
        return_to_chief: "to_chief",
        return_to_budget: "to_budget",
      }
      result = await returnPpmp(ppmpId, { step: stepMap[action] ?? "to_end_user", notes })
    }

    setLoading(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Action completed.")
    setOpen(false)
    router.refresh()
  }

  const actionLabels: Record<PpmpAction, string> = {
    chief_forward:      "Forward to Budget Officer",
    chief_return:       "Return to End User",
    certify:            "Certify Fund Availability",
    approve:            "Approve PPMP (HOPE)",
    return_to_end_user: "Return to End User",
    return_to_chief:    "Return to Section Chief",
    return_to_budget:   "Return to Budget Officer",
  }

  return (
    <div className="flex flex-wrap gap-2">
      {/* Chief Review actions */}
      {canChiefReview && ppmpStatus === "submitted" && (
        <>
          <Button size="sm" onClick={() => openDialog("chief_forward")}>
            <CheckIcon className="mr-1.5 h-3.5 w-3.5" />
            Forward to Budget Officer
          </Button>
          <Button size="sm" variant="outline" onClick={() => openDialog("chief_return")}>
            <RotateCcwIcon className="mr-1.5 h-3.5 w-3.5" />
            Return to End User
          </Button>
        </>
      )}

      {/* Budget Officer */}
      {canCertify && ppmpStatus === "chief_reviewed" && (
        <>
          <Button size="sm" onClick={() => openDialog("certify")}>
            <CheckIcon className="mr-1.5 h-3.5 w-3.5" />
            Certify Fund Availability
          </Button>
          <Button size="sm" variant="outline" onClick={() => openDialog("return_to_chief")}>
            <RotateCcwIcon className="mr-1.5 h-3.5 w-3.5" />
            Return to Section Chief
          </Button>
        </>
      )}

      {/* HOPE */}
      {canApprove && ppmpStatus === "budget_certified" && (
        <>
          <Button size="sm" onClick={() => openDialog("approve")}>
            <CheckIcon className="mr-1.5 h-3.5 w-3.5" />
            Approve PPMP
          </Button>
          <Button size="sm" variant="outline" onClick={() => openDialog("return_to_budget")}>
            <RotateCcwIcon className="mr-1.5 h-3.5 w-3.5" />
            Return to Budget Officer
          </Button>
        </>
      )}

      {/* Confirm dialog */}
      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action ? actionLabels[action] : ""}</DialogTitle>
            <DialogDescription>
              {action === "approve"
                ? "Approving will set this PPMP to FINAL and trigger APP population."
                : "Add notes or remarks below (optional for forward, required for return)."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Notes / Remarks</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={loading}>
              {loading ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
