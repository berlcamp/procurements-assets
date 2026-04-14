"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { toast } from "sonner"
import {
  ppmpProjectSchema, ppmpLotSchema, ppmpLotItemSchema,
  type PpmpProjectInput, type PpmpLotInput, type PpmpLotItemInput,
  PPMP_PROJECT_TYPE_LABELS, PROCUREMENT_MODES, SCHEDULE_QUARTERS,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
      <DialogContent className="flex max-h-[min(88vh,880px)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-5 text-left">
          <DialogTitle className="text-lg">Add procurement project</DialogTitle>
          <DialogDescription>
            GPPB columns 1–2 — describe the procurement and classify it by project type before adding lots and line items.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
            <div className="space-y-8">
              <section className="space-y-4" aria-labelledby="ppmp-project-section-desc">
                <h3
                  id="ppmp-project-section-desc"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Description &amp; objective
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="ppmp-project-description">General description and objective *</Label>
                  <Textarea
                    id="ppmp-project-description"
                    {...register("general_description")}
                    placeholder="Concise description of the project and its intended purpose…"
                    rows={5}
                    className="min-h-[140px] resize-y"
                  />
                  {errors.general_description && (
                    <p className="text-xs text-destructive">{errors.general_description.message}</p>
                  )}
                </div>
              </section>

              <section className="space-y-4" aria-labelledby="ppmp-project-section-type">
                <h3
                  id="ppmp-project-section-type"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Classification
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="ppmp-project-type">Type of project *</Label>
                  <Select
                    onValueChange={(v) => { if (v) setValue("project_type", v as PpmpProjectInput["project_type"]) }}
                    value={watch("project_type") ?? ""}
                    items={PPMP_PROJECT_TYPE_LABELS as Record<string, React.ReactNode>}
                  >
                    <SelectTrigger id="ppmp-project-type" className="h-11 w-full sm:max-w-md">
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
              </section>
            </div>
          </div>

          <DialogFooter className="!mx-0 !mb-0 mt-auto shrink-0 gap-2 border-t border-border bg-muted/40 px-6 py-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="min-h-11 min-w-[7rem]">
              {saving ? "Adding…" : "Add project"}
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
      <DialogContent className="flex max-h-[min(88vh,880px)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-5 text-left">
          <DialogTitle className="text-lg">Add Lot</DialogTitle>
          <DialogDescription>
            GPPB columns 4–12. Group line items that share the same mode, timeline, and budget.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
            <div className="space-y-8">
              <section className="space-y-4" aria-labelledby="lot-section-details">
                <h3
                  id="lot-section-details"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Lot details
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-lot-title">Lot title</Label>
                    <Input
                      id="ppmp-lot-title"
                      {...register("lot_title")}
                      placeholder="e.g. Lot 1 — Office supplies"
                      className="h-11"
                    />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,280px)] lg:items-start">
                    <div className="space-y-2">
                      <Label htmlFor="ppmp-lot-mode">Mode of procurement *</Label>
                      <Select
                        onValueChange={(v) => { if (v) setValue("procurement_mode", v) }}
                        value={watch("procurement_mode") ?? "competitive_bidding"}
                        items={Object.fromEntries(PROCUREMENT_MODES.map((m) => [m.value, m.label]))}
                      >
                        <SelectTrigger id="ppmp-lot-mode" className="h-11 w-full">
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
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 lg:min-h-[3.25rem] lg:items-center">
                        <Checkbox
                          id="pre_proc_conf"
                          checked={watch("pre_procurement_conference")}
                          onCheckedChange={(v) => setValue("pre_procurement_conference", !!v)}
                        />
                        <Label htmlFor="pre_proc_conf" className="cursor-pointer text-sm leading-snug font-normal">
                          Pre-procurement conference required
                        </Label>
                      </div>
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 lg:min-h-[3.25rem] lg:items-center">
                        <Checkbox
                          id="is_cse"
                          checked={watch("is_cse")}
                          onCheckedChange={(v) => setValue("is_cse", !!v)}
                        />
                        <Label htmlFor="is_cse" className="cursor-pointer text-sm leading-snug font-normal">
                          Common-Use Supplies &amp; Equipment (CSE)
                          <span className="block text-xs text-muted-foreground font-normal">Must procure from PS-DBM</span>
                        </Label>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4" aria-labelledby="lot-section-timeline">
                <h3
                  id="lot-section-timeline"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Schedule
                </h3>
                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-quarter">Quarter</Label>
                    <Select
                      onValueChange={(v) => { if (v) setValue("schedule_quarter", v as "Q1" | "Q2" | "Q3" | "Q4") }}
                      value={watch("schedule_quarter") ?? ""}
                    >
                      <SelectTrigger id="ppmp-quarter" className="h-11 w-full">
                        <SelectValue placeholder="Select quarter" />
                      </SelectTrigger>
                      <SelectContent>
                        {SCHEDULE_QUARTERS.map((q) => (
                          <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-proc-start">Procurement start (MM/YYYY)</Label>
                    <Input
                      id="ppmp-proc-start"
                      {...register("procurement_start")}
                      placeholder="04/2026"
                      className="h-11 font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-proc-end">Procurement end (MM/YYYY)</Label>
                    <Input
                      id="ppmp-proc-end"
                      {...register("procurement_end")}
                      placeholder="05/2026"
                      className="h-11 font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-delivery">Delivery period</Label>
                    <Input
                      id="ppmp-delivery"
                      {...register("delivery_period")}
                      placeholder="07/2026"
                      className="h-11 font-mono"
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-adv-date">Advertisement (MM/YYYY)</Label>
                    <Input
                      id="ppmp-adv-date"
                      {...register("advertisement_date")}
                      placeholder="04/2026"
                      className="h-11 font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-bid-date">Bid opening (MM/YYYY)</Label>
                    <Input
                      id="ppmp-bid-date"
                      {...register("bid_opening_date")}
                      placeholder="05/2026"
                      className="h-11 font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-award-date">Award (MM/YYYY)</Label>
                    <Input
                      id="ppmp-award-date"
                      {...register("award_date")}
                      placeholder="06/2026"
                      className="h-11 font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-contract-date">Contract signing (MM/YYYY)</Label>
                    <Input
                      id="ppmp-contract-date"
                      {...register("contract_signing_date")}
                      placeholder="06/2026"
                      className="h-11 font-mono"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-4" aria-labelledby="lot-section-budget">
                <h3
                  id="lot-section-budget"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Budget &amp; funds
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="ppmp-funds">Source of funds</Label>
                    <Input
                      id="ppmp-funds"
                      {...register("source_of_funds")}
                      placeholder="e.g. GAA 2026 — Current appropriation"
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="ppmp-abc">Estimated budget / ABC *</Label>
                    <Input
                      id="ppmp-abc"
                      {...register("estimated_budget")}
                      type="number"
                      step="0.01"
                      min="0"
                      className="h-11 max-w-full sm:max-w-xs"
                    />
                    {errors.estimated_budget && (
                      <p className="text-xs text-destructive">{errors.estimated_budget.message}</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="space-y-4" aria-labelledby="lot-section-notes">
                <h3
                  id="lot-section-notes"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Supporting info
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-supporting">Supporting documents</Label>
                    <Input
                      id="ppmp-supporting"
                      {...register("supporting_documents")}
                      placeholder="e.g. Technical specifications, scope of work"
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-remarks">Remarks</Label>
                    <Input
                      id="ppmp-remarks"
                      {...register("remarks")}
                      placeholder="Optional notes"
                      className="h-11"
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>

          <DialogFooter className="!mx-0 !mb-0 mt-auto shrink-0 gap-2 border-t border-border bg-muted/40 px-6 py-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="min-h-11 min-w-[7rem]">
              {saving ? "Adding…" : "Add Lot"}
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
      <DialogContent className="flex max-h-[min(88vh,880px)] w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-5 text-left">
          <DialogTitle className="text-lg">Add item to lot</DialogTitle>
          <DialogDescription>
            GPPB column 3 — line item description, quantity, unit, and technical details for this lot.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
            <div className="space-y-8">
              <section className="space-y-4" aria-labelledby="lot-item-section-main">
                <h3
                  id="lot-item-section-main"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Item details
                </h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ppmp-item-desc">Description *</Label>
                    <Input
                      id="ppmp-item-desc"
                      {...register("description")}
                      placeholder="e.g. Desktop computer, short-sleeved T-shirt"
                      className="h-11"
                    />
                    {errors.description && (
                      <p className="text-xs text-destructive">{errors.description.message}</p>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="ppmp-item-qty">Quantity *</Label>
                      <Input
                        id="ppmp-item-qty"
                        {...register("quantity")}
                        type="number"
                        step="0.0001"
                        min="0.0001"
                        className="h-11 font-mono"
                      />
                      {errors.quantity && (
                        <p className="text-xs text-destructive">{errors.quantity.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ppmp-item-unit">Unit *</Label>
                      <Input
                        id="ppmp-item-unit"
                        {...register("unit")}
                        placeholder="piece, ream, lot…"
                        className="h-11"
                      />
                      {errors.unit && (
                        <p className="text-xs text-destructive">{errors.unit.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ppmp-item-unit-cost">Unit cost</Label>
                      <Input
                        id="ppmp-item-unit-cost"
                        {...register("estimated_unit_cost")}
                        type="number"
                        step="0.01"
                        min="0"
                        className="h-11 font-mono"
                      />
                      {errors.estimated_unit_cost && (
                        <p className="text-xs text-destructive">{errors.estimated_unit_cost.message}</p>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4" aria-labelledby="lot-item-section-spec">
                <h3
                  id="lot-item-section-spec"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Specification / size
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="ppmp-item-spec">Details</Label>
                  <Textarea
                    id="ppmp-item-spec"
                    {...register("specification")}
                    placeholder="e.g. 15-inch monitor, 16GB RAM, standard adult size"
                    rows={4}
                    className="min-h-[120px] resize-y"
                  />
                </div>
              </section>
            </div>
          </div>

          <DialogFooter className="!mx-0 !mb-0 mt-auto shrink-0 gap-2 border-t border-border bg-muted/40 px-6 py-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="min-h-11 min-w-[7rem]">
              {saving ? "Adding…" : "Add item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
