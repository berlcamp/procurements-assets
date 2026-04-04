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
import { createAppLot, assignItemsToLot, unassignItemsFromLot, finalizeLot } from "@/lib/actions/app"
import { PROCUREMENT_MODES } from "@/lib/schemas/ppmp"
import type { AppItemWithOffice, AppLotWithItems } from "@/types/database"

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
              <AppLotCard lot={lot} />

              {/* Lot items */}
              {lot.app_items && lot.app_items.length > 0 && (
                <div className="ml-4 rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">#</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Est. Budget</TableHead>
                        {canManageLots && lot.status === "draft" && (
                          <TableHead className="w-[80px]" />
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lot.app_items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {item.lot_item_number}
                          </TableCell>
                          <TableCell className="text-sm">{item.general_description}</TableCell>
                          <TableCell className="text-right">
                            <AmountDisplay amount={item.estimated_budget} className="text-sm" />
                          </TableCell>
                          {canManageLots && lot.status === "draft" && (
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Lot</DialogTitle>
            <DialogDescription>
              Group approved APP items into a procurement lot.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="lot-name">Lot Name</Label>
              <Input
                id="lot-name"
                placeholder="e.g., Office Supplies, IT Equipment"
                value={lotName}
                onChange={(e) => setLotName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="lot-desc">Description (optional)</Label>
              <Textarea
                id="lot-desc"
                placeholder="Brief description of this lot..."
                value={lotDesc}
                onChange={(e) => setLotDesc(e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <Label htmlFor="lot-method">Procurement Method (optional)</Label>
              <Select value={lotMethod} onValueChange={(v) => setLotMethod(v ?? "")} items={procurementMethodItems}>
                <SelectTrigger>
                  <SelectValue placeholder="Select method..." />
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateLot} disabled={lotName.trim().length < 3 || isPending}>
              Create Lot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Items Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assign Items to Lot</DialogTitle>
            <DialogDescription>
              Select HOPE-approved items and assign them to a lot.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Target Lot</Label>
              <Select value={assignLotId} onValueChange={(v) => setAssignLotId(v ?? "")} items={lotItems}>
                <SelectTrigger>
                  <SelectValue placeholder="Select lot..." />
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
            <div className="max-h-[300px] overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]" />
                    <TableHead>#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvedUnlottedItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedItems.has(item.id)}
                          onCheckedChange={() => toggleItemSelect(item.id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.item_number}</TableCell>
                      <TableCell className="text-sm">{item.general_description}</TableCell>
                      <TableCell className="text-right">
                        <AmountDisplay amount={item.estimated_budget} className="text-sm" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAssignItems}
              disabled={!assignLotId || selectedItems.size === 0 || isPending}
            >
              Assign {selectedItems.size} Item{selectedItems.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
