"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createPpmpAmendment } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { FilePenIcon } from "lucide-react"

interface PpmpAmendmentButtonProps {
  ppmpId: string
}

export function PpmpAmendmentButton({ ppmpId }: PpmpAmendmentButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [justification, setJustification] = useState("")
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (justification.trim().length < 20) return
    startTransition(async () => {
      const result = await createPpmpAmendment(ppmpId, { justification: justification.trim() })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Amendment created. You can now edit the PPMP.")
      setOpen(false)
      setJustification("")
      router.refresh()
    })
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FilePenIcon className="mr-1.5 h-3.5 w-3.5" />
        Request Amendment
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request PPMP Amendment</DialogTitle>
            <DialogDescription>
              This will create a new draft version based on the current approved PPMP.
              You can then edit and re-submit it for review.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Justification</Label>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Explain why this amendment is needed (min 20 characters)..."
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              {justification.trim().length}/20 characters minimum
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={isPending || justification.trim().length < 20}
            >
              {isPending ? "Creating..." : "Create Amendment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
