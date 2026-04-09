"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { setPhilgepsReference } from "@/lib/actions/procurement-activities"

interface PhilgepsReferenceDialogProps {
  procurementId: string
  currentReference: string | null
  variant?: "button" | "icon"
}

export function PhilgepsReferenceDialog({
  procurementId,
  currentReference,
  variant = "button",
}: PhilgepsReferenceDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(currentReference ?? "")
  const [busy, setBusy] = useState(false)

  function handleOpen(next: boolean) {
    setOpen(next)
    if (next) setValue(currentReference ?? "")
  }

  async function handleSave() {
    if (value.trim().length < 3) {
      toast.error("Reference must be at least 3 characters")
      return
    }
    setBusy(true)
    const result = await setPhilgepsReference(procurementId, value)
    setBusy(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("PhilGEPS reference saved")
    setOpen(false)
    router.refresh()
  }

  const isEdit = !!currentReference
  const triggerLabel = isEdit ? "Edit PhilGEPS Reference" : "Set PhilGEPS Reference"

  return (
    <>
      {variant === "icon" ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => handleOpen(true)}
          title={triggerLabel}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant={isEdit ? "outline" : "default"}
          onClick={() => handleOpen(true)}
        >
          {isEdit ? <Pencil className="mr-1.5 h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
          {triggerLabel}
        </Button>
      )}

      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{triggerLabel}</DialogTitle>
            <DialogDescription>
              RA 12009 requires opportunities for SVP, Shopping, and Bidding to be published on PhilGEPS.
              Enter the reference number assigned by PhilGEPS after publishing the RFQ or canvass.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="philgeps-ref">PhilGEPS Reference Number *</Label>
            <Input
              id="philgeps-ref"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="e.g. 12345678"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Setting this will mark the procurement as published on PhilGEPS as of now.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
