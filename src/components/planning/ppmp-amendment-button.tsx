"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createPpmpAmendment } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { FilePenIcon, TriangleAlertIcon } from "lucide-react"

interface PpmpAmendmentButtonProps {
  ppmpId: string
}

/** The in-flight refusal, held so the dialog can offer an override in place. */
interface BlockedState {
  message: string
  count: number
  canOverride: boolean
}

const MIN_JUSTIFICATION = 20

export function PpmpAmendmentButton({ ppmpId }: PpmpAmendmentButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [justification, setJustification] = useState("")
  const [blocked, setBlocked] = useState<BlockedState | null>(null)
  const [isPending, startTransition] = useTransition()

  const justificationTooShort = justification.trim().length < MIN_JUSTIFICATION

  function closeDialog() {
    setOpen(false)
    setJustification("")
    // Clear the refusal too. Leaving it set would show a stale "N items in
    // procurement" the next time the dialog opens, after the BAC may well have
    // cancelled the activities that caused it.
    setBlocked(null)
  }

  function submit(force: boolean) {
    if (justificationTooShort) return
    startTransition(async () => {
      const result = await createPpmpAmendment(
        ppmpId,
        { justification: justification.trim() },
        force,
      )

      if (result.error) {
        // The in-flight guard is the one refusal that has a way forward, so it
        // is shown inside the dialog next to that affordance rather than in a
        // toast that disappears while the user is deciding.
        if (result.blockedByInflight) {
          setBlocked({
            message: result.error,
            count: result.inflightCount ?? 0,
            canOverride: result.canOverride === true,
          })
          return
        }
        toast.error(result.error)
        return
      }

      toast.success(
        force
          ? "Amendment created over items already in procurement. The override was recorded in the approval log."
          : "Amendment created. You can now edit the PPMP.",
      )
      closeDialog()
      router.refresh()
    })
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FilePenIcon className="mr-1.5 h-3.5 w-3.5" />
        Request Amendment
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!o && !isPending) closeDialog() }}>
        <DialogContent showCloseButton={!isPending}>
          <DialogHeader>
            <DialogTitle>Request PPMP Amendment</DialogTitle>
            <DialogDescription>
              This will create a new draft version based on the current approved PPMP.
              You can then edit and re-submit it for review.
            </DialogDescription>
          </DialogHeader>

          {blocked && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>
                {blocked.count === 1
                  ? "1 item is already in procurement"
                  : `${blocked.count} items are already in procurement`}
              </AlertTitle>
              <AlertDescription>{blocked.message}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Justification</Label>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Explain why this amendment is needed (min 20 characters)..."
              rows={4}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              {/* The counter always wins while the text is too short — the
                  override button is disabled below that length, and swapping
                  the counter out would leave a disabled button with no reason. */}
              {blocked?.canOverride && !justificationTooShort
                ? "This justification is stored with the override in the approval log."
                : `${justification.trim().length}/${MIN_JUSTIFICATION} characters minimum`}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Cancel
            </Button>
            {blocked ? (
              // The override button appears only for holders of
              // ppmp.amend_override. This is an affordance, not a gate — the RPC
              // re-checks the permission (20260809_amendment_guards.sql:425), so
              // a client that forced the flag would still be refused.
              blocked.canOverride ? (
                <Button
                  variant="destructive"
                  onClick={() => submit(true)}
                  disabled={isPending || justificationTooShort}
                >
                  {isPending ? "Amending..." : "Amend anyway"}
                </Button>
              ) : null
            ) : (
              <Button
                onClick={() => submit(false)}
                disabled={isPending || justificationTooShort}
              >
                {isPending ? "Creating..." : "Create Amendment"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
