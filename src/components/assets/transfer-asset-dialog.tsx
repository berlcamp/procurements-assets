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
import { transferAsset } from "@/lib/actions/assets"
import {
  transferAssetSchema,
  type TransferAssetInput,
} from "@/lib/schemas/asset"
import type { AssetWithDetails, Office } from "@/types/database"

interface TransferAssetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: AssetWithDetails | null
  offices: Office[]
  users: Array<{ id: string; first_name: string; last_name: string; office_name: string | null }>
  onComplete: () => void
}

export function TransferAssetDialog({
  open,
  onOpenChange,
  asset,
  offices,
  users,
  onComplete,
}: TransferAssetDialogProps) {
  const {
    setValue,
    watch,
    handleSubmit,
    register,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TransferAssetInput>({
    resolver: zodResolver(transferAssetSchema),
    defaultValues: {
      asset_id: asset?.id ?? "",
      new_custodian_id: "",
      new_office_id: null,
      remarks: "",
    },
  })

  async function onSubmit(data: TransferAssetInput) {
    const result = await transferAsset({ ...data, asset_id: asset?.id ?? data.asset_id })
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Asset transferred successfully")
      reset()
      onComplete()
    }
  }

  if (!asset) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer Asset</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          <div className="font-mono">{asset.property_number}</div>
          <div className="text-muted-foreground">{asset.description ?? "—"}</div>
          {asset.current_custodian_profile && (
            <div className="text-muted-foreground">
              Current custodian: {asset.current_custodian_profile.first_name}{" "}
              {asset.current_custodian_profile.last_name}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>New Custodian *</Label>
            <Select
              value={watch("new_custodian_id")}
              onValueChange={(v) => setValue("new_custodian_id", v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select new custodian" />
              </SelectTrigger>
              <SelectContent>
                {users
                  .filter(u => u.id !== asset.current_custodian_id)
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.last_name}, {u.first_name}
                      {u.office_name && (
                        <span className="text-muted-foreground ml-1">({u.office_name})</span>
                      )}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {errors.new_custodian_id && (
              <p className="text-sm text-destructive">{errors.new_custodian_id.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Transfer to Office (optional)</Label>
            <Select
              value={watch("new_office_id") ?? ""}
              onValueChange={(v) => setValue("new_office_id", v || null)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Same office (no change)" />
              </SelectTrigger>
              <SelectContent>
                {offices.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Remarks</Label>
            <Textarea {...register("remarks")} placeholder="Reason for transfer" rows={2} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Transferring..." : "Transfer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
