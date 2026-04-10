"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Shield, CheckCircle2 } from "lucide-react"
import { finalizeApp, approveApp } from "@/lib/actions/app"

interface AppWorkflowActionsProps {
  appId: string
  appStatus: string
  canFinalizeApp: boolean
  canApproveApp: boolean
}

export function AppWorkflowActions({
  appId,
  appStatus,
  canFinalizeApp,
  canApproveApp,
}: AppWorkflowActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)
  const [notes, setNotes] = useState("")

  const handleFinalize = () => {
    setError(null)
    startTransition(async () => {
      const result = await finalizeApp(appId)
      if (result.error) setError(result.error)
      else {
        setFinalizeOpen(false)
        router.refresh()
      }
    })
  }

  const handleApprove = () => {
    setError(null)
    startTransition(async () => {
      const result = await approveApp(appId, notes.trim() || undefined)
      if (result.error) setError(result.error)
      else {
        setApproveOpen(false)
        router.refresh()
      }
    })
  }

  const showFinalize = canFinalizeApp && ["indicative", "under_review", "bac_finalization"].includes(appStatus)
  const showApprove = canApproveApp && appStatus === "final"

  if (!showFinalize && !showApprove) return null

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {showFinalize && (
        <Button onClick={() => setFinalizeOpen(true)} disabled={isPending} className="w-full">
          <Shield className="mr-1.5 h-4 w-4" />
          Finalize APP (Mark as FINAL)
        </Button>
      )}

      {showApprove && (
        <Button onClick={() => setApproveOpen(true)} disabled={isPending} className="w-full">
          <CheckCircle2 className="mr-1.5 h-4 w-4" />
          Approve APP
        </Button>
      )}

      <p className="text-xs text-muted-foreground">
        {showFinalize && "Finalization requires all items reviewed and all approved items assigned to finalized lots."}
        {showApprove && "Approval enables End Users to create Purchase Requests for their PPMP items."}
      </p>

      <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalize APP</DialogTitle>
            <DialogDescription>
              This will mark the APP as FINAL. All items must be reviewed and all approved items assigned to finalized lots. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizeOpen(false)} disabled={isPending}>Cancel</Button>
            <Button onClick={handleFinalize} disabled={isPending}>
              Confirm Finalization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve APP</DialogTitle>
            <DialogDescription>
              This will mark the APP as approved and enable PR creation for End Users.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Optional approval notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button onClick={handleApprove} disabled={isPending}>
              Confirm Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
