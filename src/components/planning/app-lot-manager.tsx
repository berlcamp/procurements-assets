"use client"

import { useState, useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { AppLotCard } from "./app-lot-card"
import { PlusIcon, Lock, MoveRight } from "lucide-react"
import { createAppLot, assignItemsToLot, unassignItemsFromLot, finalizeLot, deleteAppLot } from "@/lib/actions/app"
import { PROCUREMENT_MODES } from "@/lib/schemas/ppmp"
import type { AppItemWithOffice, AppLotWithItems } from "@/types/database"
import { cn } from "@/lib/utils"

const lotTableShell =
  "overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm dark:bg-card"
const lotTableHeader =
  "border-b border-border/50 bg-muted/35 [&_tr]:border-border/50 [&_tr]:hover:bg-transparent"

interface AppLotManagerProps {
  appId: string
  items: AppItemWithOffice[]
  lots: AppLotWithItems[]
  canManageLots: boolean
  canFinalizeLot: boolean
}

export function AppLotManager({ appId, items, lots, canManageLots, canFinalizeLot }: AppLotManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Create lot dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [lotName, setLotName] = useState("")
  const [lotDesc, setLotDesc] = useState("")
  const [lotMethod, setLotMethod] = useState("")

  // Assign dialog
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignLotId, setAssignLotId] = useState("")
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())

  // Delete lot confirmation
  const [deleteLotId, setDeleteLotId] = useState<string | null>(null)
  const deletingLot = lots.find(l => l.id === deleteLotId)

  const procurementMethodItems = useMemo(
    () => Object.fromEntries(PROCUREMENT_MODES.map((mode) => [mode.value, mode.label])),
    []
  )

  const lotItems = useMemo(
    () => Object.fromEntries(lots.filter(l => l.status === "draft").map((lot) => [lot.id, `Lot ${lot.lot_number}: ${lot.lot_name}`])),
    [lots]
  )

  const approvedUnlottedItems = items.filter(
    i => i.hope_review_status === "approved" && i.lot_id === null
  )

  const handleCreateLot = () => {
    if (lotName.trim().length < 3) return
    setError(null)
    startTransition(async () => {
      const result = await createAppLot(appId, {
        lot_name: lotName.trim(),
        description: lotDesc.trim() || null,
        procurement_method: lotMethod || null,
      })
      if (result.error) setError(result.error)
      else {
        setCreateOpen(false)
        setLotName("")
        setLotDesc("")
        setLotMethod("")
        router.refresh()
      }
    })
  }

  const toggleItemSelect = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAssignItems = () => {
    if (!assignLotId || selectedItems.size === 0) return
    setError(null)
    startTransition(async () => {
      const result = await assignItemsToLot(assignLotId, Array.from(selectedItems))
      if (result.error) setError(result.error)
      else {
        setAssignOpen(false)
        setSelectedItems(new Set())
        setAssignLotId("")
        router.refresh()
      }
    })
  }

  const handleUnassign = (itemIds: string[]) => {
    setError(null)
    startTransition(async () => {
      const result = await unassignItemsFromLot(itemIds)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  const handleFinalizeLot = (lotId: string) => {
    setError(null)
    startTransition(async () => {
      const result = await finalizeLot(lotId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  const handleDeleteLot = () => {
    if (!deleteLotId) return
    setError(null)
    startTransition(async () => {
      const result = await deleteAppLot(deleteLotId)
      if (result.error) setError(result.error)
      else {
        setDeleteLotId(null)
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Action buttons */}
      {canManageLots && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={isPending}>
            <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
            Create Lot
          </Button>
          {approvedUnlottedItems.length > 0 && lots.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => {
              setAssignOpen(true)
              setSelectedItems(new Set())
            }} disabled={isPending}>
              <MoveRight className="mr-1.5 h-3.5 w-3.5" />
              Assign Items to Lot
            </Button>
          )}
        </div>
      )}

      {/* Lots grid */}
      {lots.length === 0 ? (
        <div className="p-8 text-center rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">
            No lots yet. Create lots to group approved items for procurement.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {lots.map((lot) => (
            <div key={lot.id} className="space-y-2">
              <AppLotCard lot={lot} onDelete={canManageLots ? () => setDeleteLotId(lot.id) : undefined} />

              {/* Lot items */}
              {lot.app_items && lot.app_items.length > 0 && (
                <div className={cn("ml-4", lotTableShell)}>
                  <Table className="[&_td]:px-3 [&_td]:py-2.5 [&_th]:h-11 [&_th]:px-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                    <TableHeader className={lotTableHeader}>
                      <TableRow className="border-0 hover:bg-transparent">
                        <TableHead className="w-[52px]">#</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right tabular-nums">Est. budget</TableHead>
                        {canManageLots && lot.status === "draft" && (
                          <TableHead className="w-[88px] text-right" />
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody className="bg-white dark:bg-card [&_tr]:border-border/40 [&_tr:last-child]:border-0">
                      {lot.app_items.map((item) => (
                        <TableRow
                          key={item.id}
                          className="bg-white hover:bg-muted/35 dark:bg-card dark:hover:bg-muted/25"
                        >
                          <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                            {item.lot_item_number}
                          </TableCell>
                          <TableCell className="max-w-[min(100%,28rem)] whitespace-normal text-sm leading-snug">
                            {item.general_description}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <AmountDisplay amount={item.estimated_budget} className="text-sm" />
                          </TableCell>
                          {canManageLots && lot.status === "draft" && (
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 text-xs text-muted-foreground hover:text-destructive"
                                onClick={() => handleUnassign([item.id])}
                                disabled={isPending}
                              >
                                Remove
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Finalize lot button */}
              {canFinalizeLot && lot.status === "draft" && (lot.app_items?.length ?? 0) > 0 && (
                <div className="ml-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleFinalizeLot(lot.id)}
                    disabled={isPending}
                  >
                    <Lock className="mr-1.5 h-3.5 w-3.5" />
                    Finalize Lot {lot.lot_number}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Unlotted approved items summary */}
      {approvedUnlottedItems.length > 0 && (
        <div className="rounded-lg border border-dashed p-4">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
              {approvedUnlottedItems.length} unlotted
            </Badge>
            <span className="text-sm text-muted-foreground">
              approved items not yet assigned to a lot
            </span>
          </div>
        </div>
      )}

      {/* Create Lot Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
          <div className="border-b border-border/60 bg-muted/20 px-6 py-5">
            <DialogHeader className="gap-1.5">
              <DialogTitle className="text-lg font-semibold tracking-tight">Create new lot</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                Group HOPE-approved APP line items into a single procurement lot.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="lot-name" className="text-foreground">
                Lot name
              </Label>
              <Input
                id="lot-name"
                placeholder="e.g. Office supplies, IT equipment"
                value={lotName}
                onChange={(e) => setLotName(e.target.value)}
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">At least 3 characters.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lot-desc">Description (optional)</Label>
              <Textarea
                id="lot-desc"
                placeholder="Brief scope or notes for this lot…"
                value={lotDesc}
                onChange={(e) => setLotDesc(e.target.value)}
                rows={3}
                className="min-h-[5rem] resize-y"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lot-method">Procurement method (optional)</Label>
              <Select value={lotMethod} onValueChange={(v) => setLotMethod(v ?? "")} items={procurementMethodItems}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder="Select method…" />
                </SelectTrigger>
                <SelectContent>
                  {PROCUREMENT_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 rounded-b-xl border-t border-border/60 bg-muted/25 sm:gap-3">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateLot} disabled={lotName.trim().length < 3 || isPending}>
              Create lot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Lot Confirmation Dialog */}
      <Dialog open={!!deleteLotId} onOpenChange={(open) => { if (!open) setDeleteLotId(null) }}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <div className="border-b border-border/60 bg-muted/20 px-6 py-5">
            <DialogHeader className="gap-1.5">
              <DialogTitle className="text-lg font-semibold tracking-tight">Delete lot?</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                {deletingLot
                  ? `Lot ${deletingLot.lot_number}: ${deletingLot.lot_name} will be permanently deleted. Any assigned items will be returned to the unlotted pool.`
                  : "This lot will be permanently deleted."}
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 rounded-b-xl border-t border-border/60 bg-muted/25 sm:gap-3">
            <Button variant="outline" onClick={() => setDeleteLotId(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteLot} disabled={isPending}>
              Delete lot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Items Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0 sm:max-w-[42rem]">
          <div className="border-b border-border/60 bg-muted/20 px-6 py-5">
            <DialogHeader className="gap-1.5">
              <DialogTitle className="text-lg font-semibold tracking-tight">Assign items to lot</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed">
                Choose a draft lot, then select HOPE-approved items to move into it.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="assign-lot">Target lot</Label>
              <Select
                value={assignLotId}
                onValueChange={(v) => setAssignLotId(v ?? "")}
                items={lotItems}
              >
                <SelectTrigger id="assign-lot" className="h-10 w-full">
                  <SelectValue placeholder="Select a lot…" />
                </SelectTrigger>
                <SelectContent>
                  {lots.filter(l => l.status === "draft").map((lot) => (
                    <SelectItem key={lot.id} value={lot.id}>
                      Lot {lot.lot_number}: {lot.lot_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">Items to assign</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {selectedItems.size} selected
                </span>
              </div>
              <div className={cn(lotTableShell, "max-h-[min(340px,50vh)] overflow-y-auto")}>
                <Table className="[&_td]:px-3 [&_td]:py-2.5 [&_th]:h-11 [&_th]:px-3 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                  <TableHeader className={cn(lotTableHeader, "sticky top-0 z-10 shadow-[0_1px_0_0_hsl(var(--border))]")}>
                    <TableRow className="border-0 hover:bg-transparent">
                      <TableHead className="w-12" />
                      <TableHead className="w-[72px]">#</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right tabular-nums">Budget</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="bg-white dark:bg-card [&_tr]:border-border/40 [&_tr:last-child]:border-0">
                    {approvedUnlottedItems.map((item) => (
                      <TableRow
                        key={item.id}
                        className="bg-white hover:bg-muted/35 dark:bg-card dark:hover:bg-muted/25"
                      >
                        <TableCell className="align-middle">
                          <Checkbox
                            checked={selectedItems.has(item.id)}
                            onCheckedChange={() => toggleItemSelect(item.id)}
                            aria-label={`Select item ${item.item_number}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                          {item.item_number}
                        </TableCell>
                        <TableCell className="max-w-[min(100%,20rem)] whitespace-normal text-sm leading-snug">
                          {item.general_description}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <AmountDisplay amount={item.estimated_budget} className="text-sm" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 gap-2 rounded-b-xl border-t border-border/60 bg-muted/25 sm:gap-3">
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAssignItems}
              disabled={!assignLotId || selectedItems.size === 0 || isPending}
            >
              Assign {selectedItems.size} item{selectedItems.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
