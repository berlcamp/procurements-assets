"use client"

import { useState, useMemo, useTransition, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { AmountDisplay } from "@/components/shared/amount-display"
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
import { PlusIcon, CheckCircle2, MoveRight } from "lucide-react"
import {
  createAppLot, updateAppLot, assignItemsToLot, unassignItemsFromLot, finalizeLot, deleteAppLot,
} from "@/lib/actions/app"
import { PROCUREMENT_MODES } from "@/lib/schemas/ppmp"
import type { AppLotInput } from "@/lib/schemas/app"
import type { AppItemWithOffice, AppLotWithItems } from "@/types/database"
import { cn } from "@/lib/utils"

type GroupBy = "mode" | "office" | "cse" | "none"

interface ItemGroup {
  key: string
  label: string
  items: AppItemWithOffice[]
  total: number
}

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
  creatorsByPpmpId?: Record<string, string>
}

export function AppLotManager({
  appId, items, lots, canManageLots, canFinalizeLot, creatorsByPpmpId = {},
}: AppLotManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Create lot dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [lotName, setLotName] = useState("")
  const [lotDesc, setLotDesc] = useState("")
  const [lotMethod, setLotMethod] = useState("")

  // Grouping
  const [groupBy, setGroupBy] = useState<GroupBy>("mode")

  // Inline assignment state (replaces the old assign dialog)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [targetLotId, setTargetLotId] = useState("")

  // Delete lot confirmation
  const [deleteLotId, setDeleteLotId] = useState<string | null>(null)
  const deletingLot = lots.find(l => l.id === deleteLotId)

  const procurementModeLabel = useMemo(
    () => Object.fromEntries(PROCUREMENT_MODES.map((m) => [m.value, m.label])),
    []
  )

  const approvedUnlottedItems = useMemo(
    () => items.filter(i => i.hope_review_status === "approved" && i.lot_id === null),
    [items]
  )

  const draftLots = useMemo(() => lots.filter(l => l.status === "draft"), [lots])

  // Map app_item.id → ppmp_lot_items for the right panel lookup
  const lotItemsById = useMemo(() => {
    const map = new Map<string, typeof items[number]["source_ppmp_lot"]>()
    for (const item of items) map.set(item.id, item.source_ppmp_lot ?? null)
    return map
  }, [items])

  const groupedItems = useMemo((): ItemGroup[] => {
    const sorted = [...approvedUnlottedItems].sort((a, b) =>
      a.general_description.localeCompare(b.general_description)
    )
    if (groupBy === "none") {
      return [{ key: "all", label: "All Items", items: sorted, total: sorted.reduce((s, i) => s + Number(i.estimated_budget), 0) }]
    }
    const map = new Map<string, ItemGroup>()
    for (const item of sorted) {
      let key: string
      let label: string
      if (groupBy === "mode") {
        key = item.procurement_mode ?? "__none__"
        label = item.procurement_mode ? (procurementModeLabel[item.procurement_mode] ?? item.procurement_mode.replace(/_/g, " ")) : "No procurement mode"
      } else if (groupBy === "cse") {
        key = item.is_cse ? "cse" : "non_cse"
        label = item.is_cse ? "Common-Use Supplies & Equipment (CSE)" : "Non-CSE Items"
      } else {
        key = item.source_office_id ?? "__none__"
        label = item.source_office?.name ?? "Unknown office"
      }
      if (!map.has(key)) {
        map.set(key, { key, label, items: [], total: 0 })
      }
      const g = map.get(key)!
      g.items.push(item)
      g.total += Number(item.estimated_budget)
    }
    return Array.from(map.values())
  }, [approvedUnlottedItems, groupBy, procurementModeLabel])

  const allSelected =
    approvedUnlottedItems.length > 0 &&
    approvedUnlottedItems.every(i => selectedItems.has(i.id))

  const selectedTotal = useMemo(() => {
    return approvedUnlottedItems
      .filter(i => selectedItems.has(i.id))
      .reduce((sum, i) => sum + Number(i.estimated_budget), 0)
  }, [approvedUnlottedItems, selectedItems])

  const toggleItemSelect = useCallback((id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(approvedUnlottedItems.map(i => i.id)))
    }
  }, [allSelected, approvedUnlottedItems])

  const handleCreateLot = () => {
    if (lotName.trim().length < 3) return
    if (!lotMethod) { setError("Procurement method is required"); return }
    setError(null)
    startTransition(async () => {
      const result = await createAppLot(appId, {
        lot_name: lotName.trim(),
        description: lotDesc.trim() || null,
        procurement_method: lotMethod as "competitive_bidding",
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

  const handleAssignItems = useCallback((lotId: string) => {
    if (!lotId || selectedItems.size === 0) return
    setError(null)
    startTransition(async () => {
      const result = await assignItemsToLot(lotId, Array.from(selectedItems))
      if (result.error) setError(result.error)
      else {
        setSelectedItems(new Set())
        setTargetLotId("")
        router.refresh()
      }
    })
  }, [selectedItems, router])

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

  const handleUpdateLot = async (lotId: string, fields: { lot_name?: string; description?: string; procurement_method?: string }) => {
    setError(null)
    const result = await updateAppLot(lotId, fields as Partial<AppLotInput>)
    if (result.error) setError(result.error)
    else router.refresh()
    return result
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
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Two-panel grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">

        {/* ── Left panel: Available Items ── */}
        <div className="flex flex-col gap-0 rounded-xl border border-border/60 shadow-sm overflow-hidden bg-white dark:bg-card">
          {/* Panel header */}
          <div className="flex items-center gap-2 border-b border-border/50 bg-muted/35 px-4 py-3">
            {canManageLots && approvedUnlottedItems.length > 0 && (
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleSelectAll}
                aria-label="Select all items"
                className="mr-0.5"
              />
            )}
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Available Items
            </span>
            {approvedUnlottedItems.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs tabular-nums">
                {approvedUnlottedItems.length}
              </Badge>
            )}
            {approvedUnlottedItems.length > 0 && (
              <div className="ml-auto flex items-center gap-1 rounded-md border border-border/60 bg-background p-0.5">
                {(["mode", "office", "cse", "none"] as GroupBy[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGroupBy(g)}
                    className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                      groupBy === g
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {g === "mode" ? "By mode" : g === "office" ? "By office" : g === "cse" ? "By CSE" : "Flat"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Items list */}
          {approvedUnlottedItems.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-500/70" />
              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                All approved items assigned
              </p>
              <p className="text-xs text-muted-foreground">
                Every HOPE-approved item has been placed in a lot.
              </p>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              {groupedItems.map((group, gi) => {
                const groupIds = group.items.map(i => i.id)
                const allGroupSelected = groupIds.length > 0 && groupIds.every(id => selectedItems.has(id))
                const someGroupSelected = groupIds.some(id => selectedItems.has(id))
                const toggleGroup = () => {
                  setSelectedItems(prev => {
                    const next = new Set(prev)
                    if (allGroupSelected) groupIds.forEach(id => next.delete(id))
                    else groupIds.forEach(id => next.add(id))
                    return next
                  })
                }
                return (
                  <div key={group.key}>
                    {/* Group header — hidden in flat mode */}
                    {groupBy !== "none" && (
                      <div
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 border-b border-border/40",
                          gi > 0 && "border-t border-t-border/60",
                          "bg-muted/50 sticky top-0 z-10"
                        )}
                      >
                        {canManageLots && (
                          <Checkbox
                            checked={allGroupSelected}
                            data-state={someGroupSelected && !allGroupSelected ? "indeterminate" : undefined}
                            onCheckedChange={toggleGroup}
                            aria-label={`Select all in ${group.label}`}
                          />
                        )}
                        <span className="text-xs font-semibold text-foreground flex-1 truncate">
                          {group.label}
                        </span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {group.items.length} item{group.items.length !== 1 ? "s" : ""}
                        </span>
                        <AmountDisplay amount={group.total.toString()} className="text-[10px] tabular-nums text-muted-foreground" />
                      </div>
                    )}
                    <Table className="[&_td]:px-3 [&_td]:py-2.5 [&_th]:h-9 [&_th]:px-3">
                      <TableBody className="[&_tr]:border-border/40 [&_tr:last-child]:border-0">
                        {group.items.map((item) => {
                          const isSelected = selectedItems.has(item.id)
                          return (
                            <TableRow
                              key={item.id}
                              className={cn(
                                "cursor-pointer select-none transition-colors",
                                isSelected
                                  ? "bg-primary/5 hover:bg-primary/8 dark:bg-primary/10"
                                  : "bg-white hover:bg-muted/35 dark:bg-card dark:hover:bg-muted/25"
                              )}
                              onClick={() => canManageLots && toggleItemSelect(item.id)}
                            >
                              {canManageLots && (
                                <TableCell className="w-10 align-middle" onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => toggleItemSelect(item.id)}
                                    aria-label={`Select item ${item.item_number}`}
                                  />
                                </TableCell>
                              )}
                              <TableCell className="align-top">
                                <p className="text-sm leading-snug whitespace-normal">
                                  {item.general_description}
                                  {item.source_ppmp_lot?.lot_title && (
                                    <span className="text-muted-foreground"> — {item.source_ppmp_lot.lot_title}</span>
                                  )}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  {item.source_ppmp_id && creatorsByPpmpId[item.source_ppmp_id] && (
                                    <span className="text-xs text-muted-foreground">
                                      {creatorsByPpmpId[item.source_ppmp_id]}
                                    </span>
                                  )}
                                  {groupBy !== "office" && item.source_office && (
                                    <span className="text-xs text-muted-foreground">
                                      {item.source_office.code ?? item.source_office.name}
                                    </span>
                                  )}
                                  {groupBy !== "mode" && item.procurement_mode && (
                                    <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                                      {procurementModeLabel[item.procurement_mode] ?? item.procurement_mode.replace(/_/g, " ")}
                                    </Badge>
                                  )}
                                </div>
                                {/* Compact line items list */}
                                {(item.source_ppmp_lot?.ppmp_lot_items?.length ?? 0) > 0 && (
                                  <ul className="mt-1.5 space-y-0.5">
                                    {item.source_ppmp_lot!.ppmp_lot_items.map((li) => (
                                      <li key={li.id} className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
                                        <span className="tabular-nums shrink-0">
                                          {Number(li.quantity).toLocaleString()} {li.unit}
                                        </span>
                                        <span className="truncate">{li.description}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums align-top">
                                <AmountDisplay amount={item.estimated_budget} className="text-sm" />
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )
              })}
            </div>
          )}

          {/* Inline assign footer — only shown when items selected */}
          {canManageLots && selectedItems.size > 0 && (
            <div className="border-t border-border/50 bg-muted/20 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  <span className="font-semibold text-foreground">{selectedItems.size}</span> selected
                  {" · "}
                  <AmountDisplay amount={selectedTotal.toString()} className="inline text-xs" />
                </span>
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <MoveRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <Select value={targetLotId} onValueChange={(v) => setTargetLotId(v ?? "")}>
                    <SelectTrigger className="h-8 min-w-[10rem] flex-1 text-xs">
                      <SelectValue placeholder="Choose lot…" />
                    </SelectTrigger>
                    <SelectContent>
                      {draftLots.map((lot) => (
                        <SelectItem key={lot.id} value={lot.id}>
                          Lot {lot.lot_number}: {lot.lot_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-8 shrink-0"
                    disabled={!targetLotId || isPending}
                    onClick={() => handleAssignItems(targetLotId)}
                  >
                    Assign
                  </Button>
                </div>
              </div>
              {draftLots.length === 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  No draft lots available. Create a lot first.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Right panel: Procurement Lots ── */}
        <div className="flex flex-col gap-4">
          {/* Panel header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Procurement Lots
              </span>
              {lots.length > 0 && (
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {lots.length}
                </Badge>
              )}
            </div>
            {canManageLots && (
              <Button size="sm" onClick={() => setCreateOpen(true)} disabled={isPending}>
                <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
                Create Lot
              </Button>
            )}
          </div>

          {/* Lots list */}
          {lots.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No lots yet. Create a lot to start grouping approved items for procurement.
              </p>
              {canManageLots && (
                <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)} disabled={isPending}>
                  <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
                  Create your first lot
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {lots.map((lot) => (
                <div key={lot.id} className="space-y-2">
                  <AppLotCard
                    lot={lot}
                    isPending={isPending}
                    onDelete={canManageLots ? () => setDeleteLotId(lot.id) : undefined}
                    onUpdate={canManageLots ? (fields) => handleUpdateLot(lot.id, fields) : undefined}
                    onFinalize={
                      canFinalizeLot && lot.status === "draft" && (lot.app_items?.length ?? 0) > 0
                        ? () => handleFinalizeLot(lot.id)
                        : undefined
                    }
                    onQuickAdd={
                      canManageLots && lot.status === "draft"
                        ? () => handleAssignItems(lot.id)
                        : undefined
                    }
                    hasSelectedItems={selectedItems.size > 0}
                  />

                  {/* Lot items table */}
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
                              <TableCell className="max-w-[min(100%,28rem)] whitespace-normal text-sm leading-snug align-top">
                                <p>
                                  {item.general_description}
                                  {(() => {
                                    const lotTitle = lotItemsById.get(item.id)?.lot_title
                                    return lotTitle ? <span className="text-muted-foreground"> — {lotTitle}</span> : null
                                  })()}
                                </p>
                                {item.source_ppmp_id && creatorsByPpmpId[item.source_ppmp_id] && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {creatorsByPpmpId[item.source_ppmp_id]}
                                  </p>
                                )}
                                {(() => {
                                  const ppmpItems = lotItemsById.get(item.id)?.ppmp_lot_items ?? []
                                  return ppmpItems.length > 0 ? (
                                    <ul className="mt-1.5 space-y-0.5">
                                      {ppmpItems.map((li) => (
                                        <li key={li.id} className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
                                          <span className="tabular-nums shrink-0">
                                            {Number(li.quantity).toLocaleString()} {li.unit}
                                          </span>
                                          <span className="truncate">{li.description}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : null
                                })()}
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
              <Select value={lotMethod} onValueChange={(v) => setLotMethod(v ?? "")} items={procurementModeLabel}>
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
    </div>
  )
}
