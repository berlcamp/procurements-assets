"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
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
import { updateAssetCondition } from "@/lib/actions/assets"
import {
  updateConditionSchema,
  CONDITION_STATUSES,
  CONDITION_STATUS_LABELS,
  type UpdateConditionInput,
} from "@/lib/schemas/asset"
import type { AssetWithDetails } from "@/types/database"

interface UpdateConditionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: AssetWithDetails | null
  onComplete: () => void
}

export function UpdateConditionDialog({
  open,
  onOpenChange,
  asset,
  onComplete,
}: UpdateConditionDialogProps) {
  const {
    setValue,
    watch,
    handleSubmit,
    register,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateConditionInput>({
    resolver: zodResolver(updateConditionSchema),
    defaultValues: {
      condition_status: asset?.condition_status ?? "serviceable",
      remarks: "",
    },
  })

  async function onSubmit(data: UpdateConditionInput) {
    if (!asset) return
    const result = await updateAssetCondition(asset.id, data)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Condition updated")
      reset()
      onComplete()
    }
  }

  if (!asset) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Update Condition</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          <div className="font-mono">{asset.property_number}</div>
          <div className="text-muted-foreground">{asset.description ?? "—"}</div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Condition *</Label>
            <Select
              value={watch("condition_status")}
              onValueChange={(v) =>
                setValue("condition_status", v as UpdateConditionInput["condition_status"])
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_STATUSES.filter(s => s !== "disposed").map((s) => (
                  <SelectItem key={s} value={s}>
                    {CONDITION_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.condition_status && (
              <p className="text-sm text-destructive">{errors.condition_status.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Remarks</Label>
            <Textarea {...register("remarks")} placeholder="Reason for condition change" rows={2} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Updating..." : "Update"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
