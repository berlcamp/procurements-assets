"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Pencil, Check, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AmountDisplay } from "@/components/shared/amount-display"
import {
  addPrItem,
  removePrItem,
  updatePrItem,
  getApprovedAppItemsForOffice,
} from "@/lib/actions/procurement"
import type { PrItem, AppItem, AppLot } from "@/types/database"
import { cn } from "@/lib/utils"

type AppItemWithLot = AppItem & {
  lot?: Pick<AppLot, "id" | "lot_name" | "lot_number"> | null
  has_active_pr?: boolean
}

interface PrDraftItemsEditorProps {
  prId: string
  officeId: string
  fiscalYearId: string
  procurementMode: string | null
  items: PrItem[]
}

function normalizeMode(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().trim()
  if (s === "small value procurement" || s === "svp") return "svp"
  if (s === "shopping") return "shopping"
  if (s === "public bidding" || s === "competitive bidding" || s === "bidding") return "competitive_bidding"
  return s
}

export function PrDraftItemsEditor({
  prId,
  officeId,
  fiscalYearId,
  procurementMode,
  items,
}: PrDraftItemsEditorProps) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{
    description: string
    unit: string
    quantity: string
    estimated_unit_cost: string
    remarks: string
  }>({ description: "", unit: "", quantity: "", estimated_unit_cost: "", remarks: "" })
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  function startEdit(item: PrItem) {
    setEditingId(item.id)
    setEditForm({
      description: item.description,
      unit: item.unit,
      quantity: String(item.quantity),
      estimated_unit_cost: String(item.estimated_unit_cost),
      remarks: item.remarks ?? "",
    })
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(itemId: string) {
    setBusy(true)
    const result = await updatePrItem(itemId, prId, {
      description: editForm.description,
      unit: editForm.unit,
      quantity: editForm.quantity,
      estimated_unit_cost: editForm.estimated_unit_cost,
      remarks: editForm.remarks || null,
    })
    setBusy(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Line updated")
    setEditingId(null)
    router.refresh()
  }

  async function handleRemove(itemId: string) {
    if (items.length <= 1) {
      toast.error("A Purchase Request must have at least one line item")
      return
    }
    setBusy(true)
    const result = await removePrItem(itemId, prId)
    setBusy(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Line removed")
    router.refresh()
  }

  const grandTotal = items.reduce(
    (sum, i) => sum + parseFloat(i.estimated_total_cost ?? "0"),
    0
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Editable while the PR is in draft. Inline edits save per row.
        </p>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add APP Item
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-20">Unit</TableHead>
            <TableHead className="w-24 text-right">Qty</TableHead>
            <TableHead className="w-32 text-right">Unit Cost</TableHead>
            <TableHead className="w-32 text-right">Total</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(item => {
            const isEditing = editingId === item.id
            return (
              <TableRow key={item.id}>
                <TableCell className="text-muted-foreground text-sm">{item.item_number}</TableCell>
                <TableCell>
                  {isEditing ? (
                    <Input
                      value={editForm.description}
                      onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                    />
                  ) : (
                    <div>
                      <div>{item.description}</div>
                      {item.remarks && (
                        <div className="text-xs text-muted-foreground">{item.remarks}</div>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {isEditing ? (
                    <Input
                      value={editForm.unit}
                      onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))}
                    />
                  ) : (
                    item.unit
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isEditing ? (
                    <Input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={editForm.quantity}
                      onChange={e => setEditForm(f => ({ ...f, quantity: e.target.value }))}
                      className="text-right"
                    />
                  ) : (
                    item.quantity
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {isEditing ? (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editForm.estimated_unit_cost}
                      onChange={e => setEditForm(f => ({ ...f, estimated_unit_cost: e.target.value }))}
                      className="text-right"
                    />
                  ) : (
                    <AmountDisplay amount={item.estimated_unit_cost} />
                  )}
                </TableCell>
                <TableCell className="text-right font-medium">
                  <AmountDisplay amount={item.estimated_total_cost} />
                </TableCell>
                <TableCell className="text-right">
                  {isEditing ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-green-600"
                        onClick={() => saveEdit(item.id)}
                        disabled={busy}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={cancelEdit}
                        disabled={busy}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => startEdit(item)}
                        disabled={busy}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemove(item.id)}
                        disabled={busy || items.length <= 1}
                        title={items.length <= 1 ? "PR must have at least one item" : "Remove line"}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        <tfoot>
          <tr>
            <td colSpan={5} className="px-4 py-2 text-right font-semibold text-sm">
              Grand Total
            </td>
            <td className="px-4 py-2 text-right font-bold">
              <AmountDisplay amount={grandTotal.toString()} />
            </td>
            <td />
          </tr>
        </tfoot>
      </Table>

      <AddPrItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        prId={prId}
        officeId={officeId}
        fiscalYearId={fiscalYearId}
        procurementMode={procurementMode}
        excludedAppItemIds={items.map(i => i.app_item_id).filter((id): id is string => !!id)}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Add APP Item dialog
// ────────────────────────────────────────────────────────────────────────────

interface AddPrItemDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prId: string
  officeId: string
  fiscalYearId: string
  procurementMode: string | null
  excludedAppItemIds: string[]
  onSuccess: () => void
}

function AddPrItemDialog({
  open,
  onOpenChange,
  prId,
  officeId,
  fiscalYearId,
  procurementMode,
  excludedAppItemIds,
  onSuccess,
}: AddPrItemDialogProps) {
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AppItemWithLot[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [quantity, setQuantity] = useState("1")
  const [unit, setUnit] = useState("")
  const [unitCost, setUnitCost] = useState("0")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelectedId("")
    setQuantity("1")
    setUnit("")
    setUnitCost("0")
    setLoading(true)
    getApprovedAppItemsForOffice(officeId, fiscalYearId)
      .then(data => setItems(data as AppItemWithLot[]))
      .finally(() => setLoading(false))
  }, [open, officeId, fiscalYearId])

  // Filter to items that match the PR's mode and aren't already in this PR
  const eligibleItems = items.filter(i => {
    if (excludedAppItemIds.includes(i.id)) return false
    if (i.has_active_pr) return false
    if (procurementMode && normalizeMode(i.procurement_mode) !== normalizeMode(procurementMode)) return false
    return true
  })

  const selectedItem = items.find(i => i.id === selectedId)

  function handleSelect(item: AppItemWithLot) {
    setSelectedId(item.id)
    setUnitCost(String(item.estimated_budget ?? "0"))
  }

  async function handleConfirm() {
    if (!selectedItem) {
      toast.error("Select an APP item")
      return
    }
    setBusy(true)
    const result = await addPrItem(prId, {
      app_item_id: selectedItem.id,
      description: selectedItem.general_description,
      unit,
      quantity,
      estimated_unit_cost: unitCost,
      remarks: null,
    })
    setBusy(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Item added")
    onOpenChange(false)
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add APP Item to Purchase Request</DialogTitle>
          <DialogDescription>
            Only items planned under the same procurement mode are shown.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading items…</p>
          ) : eligibleItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No additional APP items available for this office under {procurementMode ?? "this mode"}.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {eligibleItems.map(item => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className={cn(
                    "w-full text-left rounded-md border p-3 text-sm transition-colors",
                    selectedId === item.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{item.general_description}</p>
                      <p className="text-xs text-muted-foreground">{item.procurement_mode}</p>
                    </div>
                    <div className="shrink-0 text-right space-y-1">
                      <AmountDisplay amount={item.estimated_budget} className="text-xs font-semibold" />
                      {item.lot && (
                        <Badge variant="outline" className="text-xs">Lot {item.lot.lot_number}</Badge>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedItem && (
            <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-3">
              <div className="col-span-3">
                <label className="text-xs text-muted-foreground">Description</label>
                <p className="text-sm font-medium">{selectedItem.general_description}</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Unit *</label>
                <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="pcs, set…" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Quantity *</label>
                <Input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Unit Cost *</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitCost}
                  onChange={e => setUnitCost(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={busy || !selectedItem || !unit || parseFloat(quantity) <= 0}
          >
            {busy ? "Adding…" : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
