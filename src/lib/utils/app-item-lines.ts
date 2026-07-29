import type { PpmpLotItem } from "@/types/database"

export type AppItemLine = Pick<
  PpmpLotItem,
  "id" | "item_number" | "description" | "quantity" | "unit" | "estimated_unit_cost" | "estimated_total_cost" | "specification"
>

interface LineSource {
  source_ppmp_lot_item_ids?: string[] | null
  source_ppmp_lot?: { ppmp_lot_items?: AppItemLine[] | null } | null
}

/**
 * Line items an APP item actually covers.
 *
 * BAC lotting can split an APP item so that only some of its source PPMP lot's
 * lines belong to a given row — `source_ppmp_lot_item_ids` records that subset.
 * A null/absent subset means the row covers every line of the source lot.
 */
export function appItemLines(item: LineSource): AppItemLine[] {
  const lines = item.source_ppmp_lot?.ppmp_lot_items ?? []
  const subset = item.source_ppmp_lot_item_ids
  if (!subset) return lines
  const allowed = new Set(subset)
  return lines.filter((li) => allowed.has(li.id))
}

/** Sum of a line list's estimated total cost. */
export function linesTotal(lines: AppItemLine[]): number {
  return lines.reduce((sum, li) => sum + Number(li.estimated_total_cost ?? 0), 0)
}
