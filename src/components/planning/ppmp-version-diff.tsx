"use client"

import { useState, useEffect } from "react"
import { AmountDisplay } from "@/components/shared/amount-display"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { PPMP_ITEM_CATEGORY_LABELS } from "@/lib/schemas/ppmp"
import type { PpmpVersionWithItems, PpmpItem, PpmpVersionHistoryRow } from "@/types/database"

interface PpmpVersionDiffProps {
  ppmpId: string
  versions: PpmpVersionHistoryRow[]
}

type DiffStatus = "added" | "removed" | "changed" | "unchanged"

interface DiffRow {
  status: DiffStatus
  itemNumber: number
  left: PpmpItem | null
  right: PpmpItem | null
  changes: string[]
}

function compareItems(left: PpmpItem[], right: PpmpItem[]): DiffRow[] {
  const leftMap = new Map(left.map((i) => [i.item_number, i]))
  const rightMap = new Map(right.map((i) => [i.item_number, i]))
  const allNumbers = new Set([...leftMap.keys(), ...rightMap.keys()])
  const rows: DiffRow[] = []

  for (const num of [...allNumbers].sort((a, b) => a - b)) {
    const l = leftMap.get(num) ?? null
    const r = rightMap.get(num) ?? null

    if (!l && r) {
      rows.push({ status: "added", itemNumber: num, left: null, right: r, changes: [] })
    } else if (l && !r) {
      rows.push({ status: "removed", itemNumber: num, left: l, right: null, changes: [] })
    } else if (l && r) {
      const changes: string[] = []
      if (l.description !== r.description) changes.push("description")
      if (l.quantity !== r.quantity) changes.push("quantity")
      if (l.estimated_unit_cost !== r.estimated_unit_cost) changes.push("unit cost")
      if (l.category !== r.category) changes.push("category")
      if (l.procurement_method !== r.procurement_method) changes.push("method")
      if (l.unit !== r.unit) changes.push("unit")
      if (l.schedule_q1 !== r.schedule_q1 || l.schedule_q2 !== r.schedule_q2 ||
          l.schedule_q3 !== r.schedule_q3 || l.schedule_q4 !== r.schedule_q4) changes.push("schedule")
      rows.push({
        status: changes.length > 0 ? "changed" : "unchanged",
        itemNumber: num,
        left: l,
        right: r,
        changes,
      })
    }
  }
  return rows
}

function DiffBadge({ status }: { status: DiffStatus }) {
  const config: Record<DiffStatus, { label: string; variant: "default" | "destructive" | "outline" | "secondary" }> = {
    added: { label: "Added", variant: "default" },
    removed: { label: "Removed", variant: "destructive" },
    changed: { label: "Changed", variant: "secondary" },
    unchanged: { label: "Same", variant: "outline" },
  }
  const c = config[status]
  return <Badge variant={c.variant} className="text-xs">{c.label}</Badge>
}

function ItemCell({ item, highlight }: { item: PpmpItem | null; highlight?: boolean }) {
  if (!item) return <td className="px-3 py-2 text-sm text-muted-foreground italic">—</td>
  return (
    <td className={cn("px-3 py-2 text-sm", highlight && "bg-amber-50")}>
      <p className="font-medium truncate max-w-[200px]">{item.description}</p>
      <p className="text-xs text-muted-foreground">
        {PPMP_ITEM_CATEGORY_LABELS[item.category] ?? item.category} · {item.unit} ·{" "}
        {parseFloat(item.quantity).toLocaleString("en-PH")} @{" "}
        <AmountDisplay amount={item.estimated_unit_cost} className="text-xs inline" />
      </p>
      <p className="text-xs font-mono">
        Total: <AmountDisplay amount={item.estimated_total_cost} className="text-xs inline" />
      </p>
    </td>
  )
}

export function PpmpVersionDiff({ ppmpId, versions }: PpmpVersionDiffProps) {
  const [leftVer, setLeftVer] = useState<number | null>(null)
  const [rightVer, setRightVer] = useState<number | null>(null)
  const [leftData, setLeftData] = useState<PpmpVersionWithItems | null>(null)
  const [rightData, setRightData] = useState<PpmpVersionWithItems | null>(null)
  const [loading, setLoading] = useState(false)

  // Default: compare the two most recent versions
  useEffect(() => {
    if (versions.length >= 2) {
      setLeftVer(versions[1].version_number)
      setRightVer(versions[0].version_number)
    }
  }, [versions])

  useEffect(() => {
    if (leftVer === null || rightVer === null) return
    if (leftVer === rightVer) return

    let cancelled = false
    setLoading(true)

    // Use getPpmpVersionById — but we need the version UUIDs.
    // We'll fetch all versions and pick by version_number
    import("@/lib/actions/ppmp").then(async ({ getCurrentPpmpVersion, getPpmpVersionById: getById }) => {
      // Fetch all version UUIDs for this ppmp
      const { createClient } = await import("@/lib/supabase/client")
      const supabase = createClient()
      const { data: versionRows } = await supabase
        .schema("procurements")
        .from("ppmp_versions")
        .select("id, version_number")
        .eq("ppmp_id", ppmpId)

      if (cancelled || !versionRows) {
        setLoading(false)
        return
      }

      const leftRow = versionRows.find((v: { version_number: number }) => v.version_number === leftVer)
      const rightRow = versionRows.find((v: { version_number: number }) => v.version_number === rightVer)

      if (!leftRow || !rightRow) {
        setLoading(false)
        return
      }

      const [l, r] = await Promise.all([
        getById(leftRow.id),
        getById(rightRow.id),
      ])

      if (!cancelled) {
        setLeftData(l)
        setRightData(r)
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [leftVer, rightVer, ppmpId])

  if (versions.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Version comparison requires at least two versions.
      </p>
    )
  }

  const leftItems = (leftData?.ppmp_items ?? []).filter((i) => !i.deleted_at)
  const rightItems = (rightData?.ppmp_items ?? []).filter((i) => !i.deleted_at)
  const diffRows = leftData && rightData ? compareItems(leftItems, rightItems) : []

  const addedCount = diffRows.filter((r) => r.status === "added").length
  const removedCount = diffRows.filter((r) => r.status === "removed").length
  const changedCount = diffRows.filter((r) => r.status === "changed").length

  return (
    <div className="space-y-4">
      {/* Version selectors */}
      <div className="flex items-center gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Base Version</label>
          <Select value={leftVer?.toString() ?? ""} onValueChange={(v) => { if (v) setLeftVer(parseInt(v)) }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.version_number} value={v.version_number.toString()}>
                  v{v.version_number} ({v.version_type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-muted-foreground mt-5">vs</span>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Compare With</label>
          <Select value={rightVer?.toString() ?? ""} onValueChange={(v) => { if (v) setRightVer(parseInt(v)) }}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.version_number} value={v.version_number.toString()}>
                  v{v.version_number} ({v.version_type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground animate-pulse">Loading versions...</p>
      )}

      {!loading && diffRows.length > 0 && (
        <>
          {/* Summary */}
          <div className="flex gap-3 text-xs">
            {addedCount > 0 && <Badge variant="default">{addedCount} added</Badge>}
            {removedCount > 0 && <Badge variant="destructive">{removedCount} removed</Badge>}
            {changedCount > 0 && <Badge variant="secondary">{changedCount} changed</Badge>}
            {addedCount === 0 && removedCount === 0 && changedCount === 0 && (
              <Badge variant="outline">No differences</Badge>
            )}
          </div>

          {/* Diff table */}
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-medium w-10">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium w-20">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">v{leftVer} (Base)</th>
                  <th className="px-3 py-2 text-left text-xs font-medium">v{rightVer} (Compare)</th>
                  <th className="px-3 py-2 text-left text-xs font-medium w-40">Changes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {diffRows.map((row) => (
                  <tr
                    key={row.itemNumber}
                    className={cn(
                      row.status === "added" && "bg-green-50/50",
                      row.status === "removed" && "bg-red-50/50",
                      row.status === "changed" && "bg-amber-50/30",
                    )}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{row.itemNumber}</td>
                    <td className="px-3 py-2"><DiffBadge status={row.status} /></td>
                    <ItemCell item={row.left} highlight={row.status === "changed"} />
                    <ItemCell item={row.right} highlight={row.status === "changed"} />
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.changes.length > 0 ? row.changes.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cost comparison */}
          {leftData && rightData && (
            <div className="flex gap-6 rounded-md border px-4 py-3 text-sm">
              <div>
                <span className="text-muted-foreground">v{leftVer} Total: </span>
                <AmountDisplay amount={leftData.total_estimated_cost} className="font-semibold" />
              </div>
              <div>
                <span className="text-muted-foreground">v{rightVer} Total: </span>
                <AmountDisplay amount={rightData.total_estimated_cost} className="font-semibold" />
              </div>
              <div>
                <span className="text-muted-foreground">Difference: </span>
                <AmountDisplay
                  amount={parseFloat(rightData.total_estimated_cost) - parseFloat(leftData.total_estimated_cost)}
                  showSign
                  className="font-semibold"
                />
              </div>
            </div>
          )}
        </>
      )}

      {!loading && leftVer === rightVer && leftVer !== null && (
        <p className="text-sm text-muted-foreground">Please select two different versions to compare.</p>
      )}
    </div>
  )
}
