"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { initiateDisposal, completeDisposal } from "@/lib/actions/assets"
import {
  initiateDisposalSchema,
  completeDisposalSchema,
  DISPOSAL_METHODS,
  DISPOSAL_METHOD_LABELS,
  type InitiateDisposalInput,
  type CompleteDisposalInput,
} from "@/lib/schemas/asset"
import type { AssetWithDetails } from "@/types/database"

interface DisposalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: AssetWithDetails | null
  mode: "initiate" | "complete"
  onComplete: () => void
}

export function DisposalDialog({
  open,
  onOpenChange,
  asset,
  mode,
  onComplete,
}: DisposalDialogProps) {
  const initiateForm = useForm<InitiateDisposalInput>({
    resolver: zodResolver(initiateDisposalSchema),
    defaultValues: { method: "condemnation", remarks: "" },
  })

  const completeForm = useForm<CompleteDisposalInput>({
    resolver: zodResolver(completeDisposalSchema),
    defaultValues: { disposal_reference: "" },
  })

  async function handleInitiate(data: InitiateDisposalInput) {
    if (!asset) return
    const result = await initiateDisposal(asset.id, data)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Asset marked for disposal")
      initiateForm.reset()
      onComplete()
    }
  }

  async function handleComplete(data: CompleteDisposalInput) {
    if (!asset) return
    const result = await completeDisposal(asset.id, data)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Disposal completed")
      completeForm.reset()
      onComplete()
    }
  }

  if (!asset) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "initiate" ? "Initiate Disposal" : "Complete Disposal"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          <div className="font-mono">{asset.property_number}</div>
          <div className="text-muted-foreground">{asset.description ?? "—"}</div>
          <div className="text-muted-foreground">
            Book value: {parseFloat(asset.book_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>

        {mode === "initiate" ? (
          <form onSubmit={initiateForm.handleSubmit(handleInitiate)} className="space-y-4">
            <div className="space-y-2">
              <Label>Disposal Method *</Label>
              <Select
                value={initiateForm.watch("method")}
                onValueChange={(v) =>
                  initiateForm.setValue("method", v as InitiateDisposalInput["method"])
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISPOSAL_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {DISPOSAL_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {initiateForm.formState.errors.method && (
                <p className="text-sm text-destructive">{initiateForm.formState.errors.method.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Remarks</Label>
              <Textarea {...initiateForm.register("remarks")} placeholder="Reason for disposal" rows={2} />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={initiateForm.formState.isSubmitting}>
                {initiateForm.formState.isSubmitting ? "Processing..." : "Mark for Disposal"}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={completeForm.handleSubmit(handleComplete)} className="space-y-4">
            <div className="space-y-2">
              <Label>Disposal Reference *</Label>
              <Input
                {...completeForm.register("disposal_reference")}
                placeholder="e.g. Resolution No. 2026-001"
              />
              {completeForm.formState.errors.disposal_reference && (
                <p className="text-sm text-destructive">{completeForm.formState.errors.disposal_reference.message}</p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={completeForm.formState.isSubmitting}>
                {completeForm.formState.isSubmitting ? "Processing..." : "Complete Disposal"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
