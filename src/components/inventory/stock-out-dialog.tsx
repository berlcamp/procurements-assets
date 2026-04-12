"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { stockOutForIssuance } from "@/lib/actions/inventory"
import { stockOutSchema, type StockOutInput, REFERENCE_TYPE_LABELS } from "@/lib/schemas/inventory"
import type { InventoryWithDetails } from "@/types/database"

interface StockOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventory: InventoryWithDetails | null
  onComplete: () => void
}

export function StockOutDialog({
  open,
  onOpenChange,
  inventory,
  onComplete,
}: StockOutDialogProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<StockOutInput>({
    resolver: zodResolver(stockOutSchema),
    defaultValues: {
      inventory_id: inventory?.id ?? "",
      quantity: 0,
      reference_type: "ris",
      reference_id: null,
      remarks: "",
    },
  })

  // Reset form when inventory item changes or dialog opens
  const inventoryId = inventory?.id
  useEffect(() => {
    if (open && inventoryId) {
      reset({
        inventory_id: inventoryId,
        quantity: 0,
        reference_type: "ris",
        reference_id: null,
        remarks: "",
      })
    }
  }, [inventoryId, open, reset])

  async function onSubmit(data: StockOutInput) {
    const result = await stockOutForIssuance({
      ...data,
      inventory_id: inventory?.id ?? "",
    })
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Stock out recorded successfully")
      reset()
      onComplete()
    }
  }

  const currentQty = parseFloat(inventory?.current_quantity ?? "0")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Stock Out</DialogTitle>
          <DialogDescription>
            Issue stock for {inventory?.item_catalog?.name ?? "item"}.
            Available: {currentQty.toLocaleString()} {inventory?.item_catalog?.unit ?? "units"}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="out-quantity">Quantity *</Label>
            <Input
              id="out-quantity"
              type="number"
              step="0.01"
              min="0.01"
              max={currentQty}
              {...register("quantity")}
            />
            {errors.quantity && (
              <p className="text-sm text-destructive">{errors.quantity.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Reference Type *</Label>
            <Select
              value={watch("reference_type")}
              onValueChange={(v) => setValue("reference_type", v ?? "ris")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REFERENCE_TYPE_LABELS)
                  .filter(([key]) => key !== "delivery" && key !== "physical_count" && key !== "manual")
                  .map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {errors.reference_type && (
              <p className="text-sm text-destructive">{errors.reference_type.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="out-remarks">Remarks</Label>
            <Textarea
              id="out-remarks"
              {...register("remarks")}
              placeholder="e.g. RIS No. 2026-001, Issued to John Doe"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Processing..." : "Issue Stock"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
