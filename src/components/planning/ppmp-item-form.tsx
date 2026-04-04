"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { toast } from "sonner"
import {
  ppmpProjectSchema, ppmpLotSchema, ppmpLotItemSchema,
  type PpmpProjectInput, type PpmpLotInput, type PpmpLotItemInput,
  PPMP_PROJECT_TYPE_LABELS, PROCUREMENT_MODES,
} from "@/lib/schemas/ppmp"
import { addPpmpProject, addPpmpLot, addPpmpLotItem } from "@/lib/actions/ppmp"
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

// ============================================================
// Project Form Dialog (GPPB Columns 1-2)
// ============================================================

interface PpmpProjectFormProps {
  ppmpVersionId: string
  ppmpId: string
  officeId: string
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function PpmpProjectForm({
  ppmpVersionId, ppmpId, officeId, open, onClose, onSaved,
}: PpmpProjectFormProps) {
  const [saving, setSaving] = useState(false)

  const {
    register, handleSubmit, setValue, watch, reset,
    formState: { errors },
  } = useForm<PpmpProjectInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(ppmpProjectSchema) as any,
  })

  async function onSubmit(values: PpmpProjectInput) {
    setSaving(true)
    const result = await addPpmpProject(ppmpVersionId, ppmpId, officeId, values)
    setSaving(false)
    if (result.error) { toast.error(result.error); return }
    toast.success("Procurement project added.")
    reset()
    onSaved()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Procurement Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>General Description and Objective *</Label>
            <Textarea
              {...register("general_description")}
              placeholder="Provide a concise but clear description of the project and its intended purpose..."
              rows={3}
            />
            {errors.general_description && (
              <p className="text-xs text-destructive">{errors.general_description.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Type of Project *</Label>
            <Select
              onValueChange={(v) => { if (v) setValue("project_type", v as PpmpProjectInput["project_type"]) }}
              value={watch("project_type") ?? ""}
              items={PPMP_PROJECT_TYPE_LABELS as Record<string, React.ReactNode>}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select project type" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PPMP_PROJECT_TYPE_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.project_type && (
              <p className="text-xs text-destructive">{errors.project_type.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding..." : "Add Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Lot Form Dialog (GPPB Columns 4-12)
// ============================================================

interface PpmpLotFormProps {
  projectId: string
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function PpmpLotForm({
  projectId, open, onClose, onSaved,
}: PpmpLotFormProps) {
  const [saving, setSaving] = useState(false)

  const {
    register, handleSubmit, setValue, watch, reset,
    formState: { errors },
  } = useForm<PpmpLotInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(ppmpLotSchema) as any,
    defaultValues: {
      procurement_mode: "competitive_bidding",
      pre_procurement_conference: false,
      estimated_budget: "0",
    },
  })

  async function onSubmit(values: PpmpLotInput) {
    setSaving(true)
    const result = await addPpmpLot(projectId, values)
    setSaving(false)
    if (result.error) { toast.error(result.error); return }
    toast.success("Lot added.")
    reset()
    onSaved()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Lot</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Lot Title</Label>
              <Input {...register("lot_title")} placeholder="e.g. Lot 1 - Office Supplies" />
            </div>
            <div className="space-y-2">
              <Label>Mode of Procurement *</Label>
              <Select
                onValueChange={(v) => { if (v) setValue("procurement_mode", v) }}
                value={watch("procurement_mode") ?? "competitive_bidding"}
                items={Object.fromEntries(PROCUREMENT_MODES.map((m) => [m.value, m.label]))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  {PROCUREMENT_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.procurement_mode && (
                <p className="text-xs text-destructive">{errors.procurement_mode.message}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="pre_proc_conf"
              checked={watch("pre_procurement_conference")}
              onCheckedChange={(v) => setValue("pre_procurement_conference", !!v)}
            />
            <Label htmlFor="pre_proc_conf" className="text-sm cursor-pointer">
              Pre-Procurement Conference Required
            </Label>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Start of Procurement (MM/YYYY)</Label>
              <Input {...register("procurement_start")} placeholder="e.g. 04/2026" />
            </div>
            <div className="space-y-2">
              <Label>End of Procurement (MM/YYYY)</Label>
              <Input {...register("procurement_end")} placeholder="e.g. 05/2026" />
            </div>
            <div className="space-y-2">
              <Label>Delivery Period</Label>
              <Input {...register("delivery_period")} placeholder="e.g. 07/2026" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Source of Funds</Label>
              <Input {...register("source_of_funds")} placeholder="e.g. GAA 2026 - Current Appropriation" />
            </div>
            <div className="space-y-2">
              <Label>Estimated Budget / ABC *</Label>
              <Input {...register("estimated_budget")} type="number" step="0.01" min="0" />
              {errors.estimated_budget && (
                <p className="text-xs text-destructive">{errors.estimated_budget.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Supporting Documents</Label>
            <Input {...register("supporting_documents")} placeholder="e.g. Technical Specifications, Scope of Work" />
          </div>

          <div className="space-y-2">
            <Label>Remarks</Label>
            <Input {...register("remarks")} placeholder="Optional remarks" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding..." : "Add Lot"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Lot Item Form Dialog (items within Column 3)
// ============================================================

interface PpmpLotItemFormProps {
  lotId: string
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function PpmpLotItemForm({
  lotId, open, onClose, onSaved,
}: PpmpLotItemFormProps) {
  const [saving, setSaving] = useState(false)

  const {
    register, handleSubmit, reset,
    formState: { errors },
  } = useForm<PpmpLotItemInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(ppmpLotItemSchema) as any,
  })

  async function onSubmit(values: PpmpLotItemInput) {
    setSaving(true)
    const result = await addPpmpLotItem(lotId, values)
    setSaving(false)
    if (result.error) { toast.error(result.error); return }
    toast.success("Item added to lot.")
    reset()
    onSaved()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Item to Lot</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Description *</Label>
            <Input {...register("description")} placeholder="e.g. Desktop Computer, Short-sleeved T-shirt" />
            {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Quantity *</Label>
              <Input {...register("quantity")} type="number" step="0.0001" min="0.0001" />
              {errors.quantity && <p className="text-xs text-destructive">{errors.quantity.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Unit *</Label>
              <Input {...register("unit")} placeholder="e.g. piece, ream, lot" />
              {errors.unit && <p className="text-xs text-destructive">{errors.unit.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Unit Cost</Label>
              <Input {...register("estimated_unit_cost")} type="number" step="0.01" min="0" />
              {errors.estimated_unit_cost && <p className="text-xs text-destructive">{errors.estimated_unit_cost.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Specification / Size</Label>
            <Textarea
              {...register("specification")}
              placeholder="e.g. 15-inch monitor, 16GB RAM, standard adult size"
              rows={2}
            />
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
