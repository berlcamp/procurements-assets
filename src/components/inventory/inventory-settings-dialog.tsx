"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { updateInventorySettings } from "@/lib/actions/inventory"
import {
  inventorySettingsSchema,
  type InventorySettingsInput,
} from "@/lib/schemas/inventory"
import type { InventoryWithDetails } from "@/types/database"

interface InventorySettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventory: InventoryWithDetails | null
  onComplete: () => void
}

export function InventorySettingsDialog({
  open,
  onOpenChange,
  inventory,
  onComplete,
}: InventorySettingsDialogProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InventorySettingsInput>({
    resolver: zodResolver(inventorySettingsSchema),
    defaultValues: {
      reorder_point: parseFloat(inventory?.reorder_point ?? "0"),
      location: inventory?.location ?? "",
    },
  })

  async function onSubmit(data: InventorySettingsInput) {
    if (!inventory) return
    const result = await updateInventorySettings(inventory.id, data)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Inventory settings updated")
      onComplete()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Inventory Settings</DialogTitle>
          <DialogDescription>
            Update settings for {inventory?.item_catalog?.name ?? "item"} at{" "}
            {inventory?.office?.name ?? "office"}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reorder-point">Reorder Point</Label>
            <Input
              id="reorder-point"
              type="number"
              step="0.01"
              min="0"
              {...register("reorder_point")}
            />
            <p className="text-xs text-muted-foreground">
              You will be alerted when stock falls to or below this quantity.
              Set to 0 to disable alerts.
            </p>
            {errors.reorder_point && (
              <p className="text-sm text-destructive">{errors.reorder_point.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Storage Location</Label>
            <Input
              id="location"
              {...register("location")}
              placeholder="e.g. Supply Room A, Cabinet 3"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
