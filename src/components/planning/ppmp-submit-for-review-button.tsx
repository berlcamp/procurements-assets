"use client"

import { useState, type ComponentProps } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { submitPpmp } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SendIcon } from "lucide-react"

interface PpmpSubmitForReviewButtonProps {
  ppmpId: string
  disabled?: boolean
  size?: ComponentProps<typeof Button>["size"]
  variant?: ComponentProps<typeof Button>["variant"]
}

export function PpmpSubmitForReviewButton({
  ppmpId,
  disabled = false,
  size = "sm",
  variant = "default",
}: PpmpSubmitForReviewButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirmSubmit() {
    setSubmitting(true)
    const result = await submitPpmp(ppmpId)
    setSubmitting(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    setOpen(false)
    toast.success("PPMP submitted for review.")
    router.refresh()
  }

  return (
    <>
      <Button
        size={size}
        variant={variant}
        onClick={() => setOpen(true)}
        disabled={submitting || disabled}
      >
        <SendIcon className="mr-1.5 h-3.5 w-3.5" />
        Submit for Review
      </Button>

      <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
        <DialogContent showCloseButton={!submitting}>
          <DialogHeader>
            <DialogTitle>Submit PPMP for review?</DialogTitle>
            <DialogDescription>
              This will send your PPMP to the next step in the approval chain. You can still
              receive it back for revisions if a reviewer returns it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirmSubmit} disabled={submitting}>
              <SendIcon className="mr-1.5 h-3.5 w-3.5" />
              {submitting ? "Submitting..." : "Submit for Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
