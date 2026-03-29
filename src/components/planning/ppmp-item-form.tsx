"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { toast } from "sonner"
import { ppmpItemSchema, type PpmpItemInput, PPMP_ITEM_CATEGORY_LABELS, PROCUREMENT_METHODS } from "@/lib/schemas/ppmp"
import { addPpmpItem } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"

interface PpmpItemFormProps {
  ppmpVersionId: string
  ppmpId: string
  officeId: string
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function PpmpItemForm({
  ppmpVersionId, ppmpId, officeId, open, onClose, onSaved,
}: PpmpItemFormProps) {
  const [saving, setSaving] = useState(false)

  const {
    register, handleSubmit, setValue, watch, reset,
    formState: { errors },
  } = useForm<PpmpItemInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(ppmpItemSchema) as any,
    defaultValues: {
      schedule_q1: "0", schedule_q2: "0", schedule_q3: "0", schedule_q4: "0",
      is_cse: false,
    },
  })

  async function onSubmit(values: PpmpItemInput) {
    setSaving(true)
    const result = await addPpmpItem(ppmpVersionId, ppmpId, officeId, values)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Item added.")
    reset()
    onSaved()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add PPMP Item</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select onValueChange={(v) => { if (v) setValue("category", v as PpmpItemInput["category"]) }} value={watch("category") ?? ""}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PPMP_ITEM_CATEGORY_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category && <p className="text-xs text-destructive">{errors.category.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>Procurement Method *</Label>
              <Select onValueChange={(v) => { if (v) setValue("procurement_method", v) }} value={watch("procurement_method") ?? ""}>
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {PROCUREMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.procurement_method && <p className="text-xs text-destructive">{errors.procurement_method.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Description *</Label>
            <Textarea {...register("description")} placeholder="Describe the item to be procured" rows={2} />
            {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Unit *</Label>
              <Input {...register("unit")} placeholder="e.g. piece, ream, box" />
              {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Quantity *</Label>
              <Input {...register("quantity")} type="number" step="0.0001" min="0.0001" />
              {errors.quantity && <p className="text-xs text-destructive">{errors.quantity.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Unit Cost (₱) *</Label>
              <Input {...register("estimated_unit_cost")} type="number" step="0.01" min="0" />
              {errors.estimated_unit_cost && <p className="text-xs text-destructive">{errors.estimated_unit_cost.message}</p>}
            </div>
          </div>

          <div>
            <Label className="text-sm text-muted-foreground mb-2 block">
              Quarterly Schedule (Q1+Q2+Q3+Q4 must equal Quantity)
            </Label>
            <div className="grid grid-cols-4 gap-3">
              {(["schedule_q1","schedule_q2","schedule_q3","schedule_q4"] as const).map((q, i) => (
                <div key={q} className="space-y-1">
                  <Label className="text-xs">Q{i+1}</Label>
                  <Input {...register(q)} type="number" step="0.0001" min="0" defaultValue="0" />
                </div>
              ))}
            </div>
            {errors.schedule_q4 && (
              <p className="text-xs text-destructive mt-1">{errors.schedule_q4.message}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="is_cse"
              checked={watch("is_cse")}
              onCheckedChange={(v) => setValue("is_cse", !!v)}
            />
            <Label htmlFor="is_cse" className="text-sm cursor-pointer">
              Common-use Supply Equipment (DBM-PS)
            </Label>
          </div>

          <div className="space-y-2">
            <Label>Remarks</Label>
            <Input {...register("remarks")} placeholder="Optional remarks" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding..." : "Add Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
