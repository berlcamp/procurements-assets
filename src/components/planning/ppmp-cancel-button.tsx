"use client"

import { useState, type ComponentProps } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { cancelPpmp } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { XCircleIcon } from "lucide-react"

interface PpmpCancelButtonProps {
  ppmpId: string
  size?: ComponentProps<typeof Button>["size"]
  variant?: ComponentProps<typeof Button>["variant"]
}

export function PpmpCancelButton({
  ppmpId,
  size = "sm",
  variant = "outline",
}: PpmpCancelButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  async function handleConfirmCancel() {
    setCancelling(true)
    const result = await cancelPpmp(ppmpId)
    setCancelling(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    setOpen(false)
    toast.success("PPMP cancelled.")
    router.push("/dashboard/planning/ppmp")
    router.refresh()
  }

  return (
    <>
      <Button
        size={size}
        variant={variant}
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
        disabled={cancelling}
      >
        <XCircleIcon className="mr-1.5 h-3.5 w-3.5" />
        Cancel PPMP
      </Button>

      <Dialog open={open} onOpenChange={(next) => !cancelling && setOpen(next)}>
        <DialogContent showCloseButton={!cancelling}>
          <DialogHeader>
            <DialogTitle>Cancel this PPMP?</DialogTitle>
            <DialogDescription>
              The PPMP will be marked as cancelled and removed from active lists. The record is
              preserved for audit purposes and a new PPMP can be created for the same office and
              fiscal year.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={cancelling}>
              Keep PPMP
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmCancel}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling..." : "Cancel PPMP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
