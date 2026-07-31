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
import { PlusIcon, CheckCircle2, MoveRight, X } from "lucide-react"
import {
  createAppLot, updateAppLot, assignLotItemsToLot, unassignLotItems, finalizeLot, deleteAppLot,
  releaseAppLot, authorizeEpaLot,
} from "@/lib/actions/app"
import { PROCUREMENT_MODES } from "@/lib/schemas/ppmp"
import { appItemLines, linesTotal, type AppItemLine } from "@/lib/utils/app-item-lines"
import type { AppLotInput } from "@/lib/schemas/app"
import type { AppItemWithOffice, AppLotWithItems, PlanningStage, AppVersionStatus } from "@/types/database"
import { cn } from "@/lib/utils"

type GroupBy = "mode" | "office" | "cse" | "none"

interface ItemGroup {
  key: string
  label: string
  items: AppItemWithOffice[]
  total: number
}

/**
 * Selection is per line item, not per APP item. An APP item with no PPMP line
 * items is selected as a whole via a blank line id.
 */
const selKey = (itemId: string, lineId: string) => `${itemId}|${lineId}`

/** Selection units of an APP item: one per line, or one for the item itself. */
function selectionUnits(item: AppItemWithOffice): string[] {
  const lines = appItemLines(item)
  return lines.length > 0
    ? lines.map((li) => selKey(item.id, li.id))
    : [selKey(item.id, "")]
}

/**
 * Budget the selected lines carry into a lot. Mirrors the server's
 * apportionment: proportional to line cost, by line count when costs are zero,
 * and the full budget when every line is selected.
 */
function selectedAmount(item: AppItemWithOffice, selectedLineIds: Set<string>): number {
  const budget = Number(item.estimated_budget)
  const lines = appItemLines(item)
  if (lines.length === 0) return budget
  const picked = lines.filter((li) => selectedLineIds.has(li.id))
  if (picked.length === 0) return 0
  if (picked.length === lines.length) return budget
  const all = linesTotal(lines)
  const share = all > 0 ? linesTotal(picked) / all : picked.length / lines.length
  return Math.round(budget * share * 100) / 100
}

// Clipping comes from the wrapper's overflow-x-auto, so corners still round.
const lotTableShell =
  "rounded-xl border border-border/60 bg-white shadow-sm dark:bg-card"
const lotTableHeader =
  "border-b border-border/50 bg-muted/35 [&_tr]:border-border/50 [&_tr]:hover:bg-transparent"

interface AppLotManagerProps {
  appId: string
  items: AppItemWithOffice[]
  lots: AppLotWithItems[]
  canManageLots: boolean
  canFinalizeLot: boolean
  canReleaseLots?: boolean
  canAuthorizeEpa?: boolean
  /**
   * Planning stage and status of the APP version these lots belong to. EPA is
   * only offered on an approved INDICATIVE version; a null stage means unknown
   * and must NOT be treated as indicative (the RPC fails closed on it too).
   */
  versionPlanningStage?: PlanningStage | null
  versionStatus?: AppVersionStatus | null
  creatorsByPpmpId?: Record<string, string>
}

export function AppLotManager({
  appId, items, lots, canManageLots, canFinalizeLot,
  canReleaseLots = false, canAuthorizeEpa = false,
  versionPlanningStage = null, versionStatus = null,
  creatorsByPpmpId = {},
}: AppLotManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Create lot dialog — errors stay in the dialog, where the user can see them
  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [lotName, setLotName] = useState("")
  const [lotDesc, setLotDesc] = useState("")
  const [lotMethod, setLotMethod] = useState("")

  // Grouping
  const [groupBy, setGroupBy] = useState<GroupBy>("mode")

  // Inline assignment state — a set of `${appItemId}|${lineItemId}` keys
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set())
  const [targetLotId, setTargetLotId] = useState("")

  // Delete lot confirmation
  const [deleteLotId, setDeleteLotId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deletingLot = lots.find(l => l.id === deleteLotId)

  // EPA authorization dialog — errors stay in the dialog, matching create/delete
  const [epaLotId, setEpaLotId] = useState<string | null>(null)
  const [epaJustification, setEpaJustification] = useState("")
  const [epaError, setEpaError] = useState<string | null>(null)
  const epaLot = lots.find(l => l.id === epaLotId)

  // EPA exists to let an INDICATIVE APP be bid before the GAA. A null stage is
  // unknown, not indicative — offering EPA there would invite a refusal the
  // user cannot act on, and authorize_epa_lot fails closed on it anyway.
  const epaApplies =
    canAuthorizeEpa &&
    versionStatus === "approved" &&
    versionPlanningStage === "indicative"

  const procurementModeLabel = useMemo(
    () => Object.fromEntries(PROCUREMENT_MODES.map((m) => [m.value, m.label])),
    []
  )

  const approvedUnlottedItems = useMemo(
    () => items.filter(i => i.hope_review_status === "approved" && i.lot_id === null),
    [items]
  )

  const draftLots = useMemo(() => lots.filter(l => l.status === "draft"), [lots])

  // Map app_item.id → full item, for the right panel lookup. Lotted rows in
  // `lots` come without their PPMP lot join, so resolve lines from here.
  const itemsById = useMemo(() => {
    const map = new Map<string, AppItemWithOffice>()
    for (const item of items) map.set(item.id, item)
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

  const allUnits = useMemo(
    () => approvedUnlottedItems.flatMap(selectionUnits),
    [approvedUnlottedItems]
  )

  const allSelected = allUnits.length > 0 && allUnits.every(k => selectedLines.has(k))

  // Selected line ids per APP item, used for totals and the assign payload.
  const selectionByItem = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const item of approvedUnlottedItems) {
      const picked = new Set<string>()
      for (const li of appItemLines(item)) {
        if (selectedLines.has(selKey(item.id, li.id))) picked.add(li.id)
      }
      const wholeItem = selectedLines.has(selKey(item.id, ""))
      if (picked.size > 0 || wholeItem) map.set(item.id, picked)
    }
    return map
  }, [approvedUnlottedItems, selectedLines])

  const selectedCount = useMemo(
    () => allUnits.filter(k => selectedLines.has(k)).length,
    [allUnits, selectedLines]
  )

  const selectedTotal = useMemo(() => {
    let sum = 0
    for (const item of approvedUnlottedItems) {
      const picked = selectionByItem.get(item.id)
      if (picked) sum += selectedAmount(item, picked)
    }
    return sum
  }, [approvedUnlottedItems, selectionByItem])

  const toggleKeys = useCallback((keys: string[], select?: boolean) => {
    setSelectedLines(prev => {
      const next = new Set(prev)
      const turnOn = select ?? !keys.every(k => next.has(k))
      for (const k of keys) {
        if (turnOn) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (allSelected) setSelectedLines(new Set())
    else setSelectedLines(new Set(allUnits))
  }, [allSelected, allUnits])

  const openCreateDialog = () => {
    setCreateError(null)
    setCreateOpen(true)
  }

  const handleCreateLot = () => {
    if (lotName.trim().length < 3) { setCreateError("Lot name must be at least 3 characters"); return }
    if (!lotMethod) { setCreateError("Procurement method is required"); return }
    setCreateError(null)
    startTransition(async () => {
      const result = await createAppLot(appId, {
        lot_name: lotName.trim(),
        description: lotDesc.trim() || null,
        procurement_method: lotMethod as "competitive_bidding",
      })
      if (result.error) setCreateError(result.error)
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
    if (!lotId || selectionByItem.size === 0) return
    setError(null)
    const assignments = Array.from(selectionByItem, ([appItemId, lineIds]) => ({
      appItemId,
      ppmpLotItemIds: Array.from(lineIds),
    }))
    startTransition(async () => {
      const result = await assignLotItemsToLot(lotId, assignments)
      if (result.error) setError(result.error)
      else {
        setSelectedLines(new Set())
        setTargetLotId("")
        router.refresh()
      }
    })
  }, [selectionByItem, router])

  /** Remove a whole APP item, or just some of its lines, from its lot. */
  const handleUnassign = (appItemId: string, lineIds: string[] = []) => {
    setError(null)
    startTransition(async () => {
      const result = await unassignLotItems(appItemId, lineIds)
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

  // The release/EPA RPC messages are written to be acted on — they name the
  // exact next step ("authorize EPA on this lot first", "record the GAA ceiling
  // first"). Surface them verbatim; never replace with a generic string.
  const handleReleaseLot = (lotId: string) => {
    setError(null)
    startTransition(async () => {
      const result = await releaseAppLot(lotId)
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  const handleAuthorizeEpa = () => {
    if (!epaLotId) return
    setEpaError(null)
    startTransition(async () => {
      const result = await authorizeEpaLot({
        lot_id: epaLotId,
        justification: epaJustification.trim(),
      })
      if (result.error) { setEpaError(result.error); return }
      setEpaLotId(null)
      setEpaJustification("")
      router.refresh()
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
    setDeleteError(null)
    startTransition(async () => {
      const result = await deleteAppLot(deleteLotId)
      if (result.error) setDeleteError(result.error)
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

      {/* Two-panel grid — equal halves. `min-w-0` keeps a panel's table content
          from blowing past its track and squeezing the other side. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* ── Left panel: Available Items ── */}
        <div className="flex min-w-0 flex-col gap-0 rounded-xl border border-border/60 shadow-sm overflow-hidden bg-white dark:bg-card">
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
                const groupKeys = group.items.flatMap(selectionUnits)
                const allGroupSelected = groupKeys.length > 0 && groupKeys.every(k => selectedLines.has(k))
                const someGroupSelected = groupKeys.some(k => selectedLines.has(k))
                const toggleGroup = () => toggleKeys(groupKeys, !allGroupSelected)
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
                          const lines = appItemLines(item)
                          const itemKeys = selectionUnits(item)
                          const allItemSelected = itemKeys.every(k => selectedLines.has(k))
                          const someItemSelected = itemKeys.some(k => selectedLines.has(k))
                          return (
                            <TableRow
                              key={item.id}
                              className={cn(
                                "select-none transition-colors",
                                canManageLots && "cursor-pointer",
                                someItemSelected
                                  ? "bg-primary/5 hover:bg-primary/8 dark:bg-primary/10"
                                  : "bg-white hover:bg-muted/35 dark:bg-card dark:hover:bg-muted/25"
                              )}
                              onClick={() => canManageLots && toggleKeys(itemKeys, !allItemSelected)}
                            >
                              {canManageLots && (
                                <TableCell className="w-10 align-top" onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={allItemSelected}
                                    data-state={someItemSelected && !allItemSelected ? "indeterminate" : undefined}
                                    onCheckedChange={() => toggleKeys(itemKeys, !allItemSelected)}
                                    aria-label={`Select all lines of item ${item.item_number}`}
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
                                {/* Individually selectable line items */}
                                {lines.length > 0 && (
                                  <ul className="mt-1.5 space-y-0.5">
                                    {lines.map((li) => {
                                      const k = selKey(item.id, li.id)
                                      const lineSelected = selectedLines.has(k)
                                      return (
                                        <li
                                          key={li.id}
                                          className={cn(
                                            "flex items-baseline gap-1.5 rounded px-1 py-0.5 text-[11px]",
                                            canManageLots && "cursor-pointer hover:bg-muted/50",
                                            lineSelected ? "text-foreground" : "text-muted-foreground"
                                          )}
                                          onClick={(e) => {
                                            if (!canManageLots) return
                                            e.stopPropagation()
                                            toggleKeys([k])
                                          }}
                                        >
                                          {canManageLots && (
                                            <Checkbox
                                              checked={lineSelected}
                                              onCheckedChange={() => toggleKeys([k])}
                                              onClick={(e) => e.stopPropagation()}
                                              aria-label={`Select line item ${li.description}`}
                                              className="size-3.5 shrink-0 self-center"
                                            />
                                          )}
                                          <span className="tabular-nums shrink-0">
                                            {Number(li.quantity).toLocaleString()} {li.unit}
                                          </span>
                                          <span className="flex-1 truncate">{li.description}</span>
                                          <AmountDisplay
                                            amount={li.estimated_total_cost}
                                            className="shrink-0 text-[11px] tabular-nums"
                                          />
                                        </li>
                                      )
                                    })}
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
          {canManageLots && selectedCount > 0 && (
            <div className="border-t border-border/50 bg-muted/20 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  <span className="font-semibold text-foreground">{selectedCount}</span>
                  {" "}line item{selectedCount !== 1 ? "s" : ""} selected
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
        <div className="flex min-w-0 flex-col gap-4">
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
              <Button size="sm" onClick={openCreateDialog} disabled={isPending}>
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
                <Button size="sm" variant="outline" onClick={openCreateDialog} disabled={isPending}>
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
                    onRelease={
                      canReleaseLots && lot.status === "composed"
                        ? () => handleReleaseLot(lot.id)
                        : undefined
                    }
                    onAuthorizeEpa={
                      epaApplies && lot.status === "composed" && !lot.is_early_procurement
                        ? () => { setEpaJustification(""); setEpaError(null); setEpaLotId(lot.id) }
                        : undefined
                    }
                    onQuickAdd={
                      canManageLots && lot.status === "draft"
                        ? () => handleAssignItems(lot.id)
                        : undefined
                    }
                    hasSelectedItems={selectedCount > 0}
                  />

                  {/* Lot items table — scrolls within the panel instead of
                      stretching it and squeezing the available-items side. */}
                  {lot.app_items && lot.app_items.length > 0 && (
                    <div className={cn("ml-4 min-w-0 overflow-x-auto", lotTableShell)}>
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
                          {lot.app_items.map((item) => {
                            const source = itemsById.get(item.id)
                            const lines: AppItemLine[] = source ? appItemLines(source) : []
                            const editable = canManageLots && lot.status === "draft"
                            return (
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
                                    {source?.source_ppmp_lot?.lot_title && (
                                      <span className="text-muted-foreground"> — {source.source_ppmp_lot.lot_title}</span>
                                    )}
                                  </p>
                                  {item.source_ppmp_id && creatorsByPpmpId[item.source_ppmp_id] && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      {creatorsByPpmpId[item.source_ppmp_id]}
                                    </p>
                                  )}
                                  {lines.length > 0 && (
                                    <ul className="mt-1.5 space-y-0.5">
                                      {lines.map((li) => (
                                        <li
                                          key={li.id}
                                          className="group/line flex items-baseline gap-1.5 text-[11px] text-muted-foreground"
                                        >
                                          <span className="tabular-nums shrink-0">
                                            {Number(li.quantity).toLocaleString()} {li.unit}
                                          </span>
                                          <span className="flex-1 truncate">{li.description}</span>
                                          <AmountDisplay
                                            amount={li.estimated_total_cost}
                                            className="shrink-0 text-[11px] tabular-nums"
                                          />
                                          {editable && lines.length > 1 && (
                                            <button
                                              type="button"
                                              onClick={() => handleUnassign(item.id, [li.id])}
                                              disabled={isPending}
                                              aria-label={`Remove ${li.description} from lot`}
                                              className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/line:opacity-100"
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  <AmountDisplay amount={item.estimated_budget} className="text-sm" />
                                </TableCell>
                                {editable && (
                                  <TableCell className="text-right">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 text-xs text-muted-foreground hover:text-destructive"
                                      onClick={() => handleUnassign(item.id)}
                                      disabled={isPending}
                                    >
                                      Remove
                                    </Button>
                                  </TableCell>
                                )}
                              </TableRow>
                            )
                          })}
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
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setCreateError(null) }}>
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
            {createError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
                {createError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="lot-name" className="text-foreground">
                Lot name *
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
              <Label htmlFor="lot-method">Procurement method *</Label>
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
            <Button onClick={handleCreateLot} disabled={lotName.trim().length < 3 || !lotMethod || isPending}>
              Create lot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Lot Confirmation Dialog */}
      <Dialog open={!!deleteLotId} onOpenChange={(open) => { if (!open) { setDeleteLotId(null); setDeleteError(null) } }}>
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
          {deleteError && (
            <div className="px-6 py-4">
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
                {deleteError}
              </div>
            </div>
          )}
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

      {/* EPA authorization */}
      <Dialog
        open={!!epaLotId}
        onOpenChange={(open) => { if (!open && !isPending) { setEpaLotId(null); setEpaError(null) } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Authorize Early Procurement{epaLot ? ` — Lot ${epaLot.lot_number}` : ""}
            </DialogTitle>
            <DialogDescription>
              This lot may then be bid and awarded on the indicative APP, before the
              GAA takes effect. Contract signing and the NTP stay blocked until an
              appropriation is recorded. The justification is written to the approval log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="epa-justification">Justification</Label>
            <Textarea
              id="epa-justification"
              value={epaJustification}
              onChange={(e) => setEpaJustification(e.target.value)}
              placeholder="Why is early procurement warranted for this lot? (min 20 characters)"
              rows={4}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              {epaJustification.trim().length}/20 characters minimum
            </p>
          </div>
          {epaError && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {epaError}
            </div>
          )}
          <DialogFooter className="mx-0 mb-0 gap-2 rounded-b-xl border-t border-border/60 bg-muted/25 sm:gap-3">
            <Button variant="outline" onClick={() => setEpaLotId(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleAuthorizeEpa}
              disabled={isPending || epaJustification.trim().length < 20}
            >
              {isPending ? "Authorizing..." : "Authorize EPA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
