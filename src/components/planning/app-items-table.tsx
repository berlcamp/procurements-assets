import { Badge } from "@/components/ui/badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { PROCUREMENT_MODES } from "@/lib/schemas/ppmp"
import type { AppItemWithOffice } from "@/types/database"

interface AppItemsTableProps {
  items: AppItemWithOffice[]
  showLotColumn?: boolean
}

function getProcurementModeLabel(value: string | null): string {
  if (!value) return "—"
  const mode = PROCUREMENT_MODES.find(m => m.value === value)
  return mode?.label ?? value
}

export function AppItemsTable({ items, showLotColumn = true }: AppItemsTableProps) {
  if (items.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No items yet. Items are auto-populated when PPMPs are approved.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]">#</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Source Office</TableHead>
            <TableHead>Procurement Mode</TableHead>
            <TableHead className="text-right">Est. Budget</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>HOPE Review</TableHead>
            {showLotColumn && <TableHead>Lot</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const office = item.source_office as { name: string; code: string } | null
            const lot = item.lot as { lot_name: string; lot_number: number } | null
            return (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {item.item_number}
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium text-sm">{item.general_description}</p>
                    {item.project_type && (
                      <p className="text-xs text-muted-foreground capitalize">
                        {item.project_type.replace(/_/g, " ")}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {office?.name ?? "—"}
                </TableCell>
                <TableCell className="text-sm">
                  {getProcurementModeLabel(item.procurement_mode)}
                </TableCell>
                <TableCell className="text-right">
                  <AmountDisplay amount={item.estimated_budget} className="text-sm" />
                </TableCell>
                <TableCell className="text-sm">
                  {item.procurement_start && item.procurement_end
                    ? `${item.procurement_start} – ${item.procurement_end}`
                    : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={item.hope_review_status} />
                  {item.hope_remarks && (
                    <p className="text-xs text-muted-foreground mt-1 max-w-[200px] truncate" title={item.hope_remarks}>
                      {item.hope_remarks}
                    </p>
                  )}
                </TableCell>
                {showLotColumn && (
                  <TableCell>
                    {lot ? (
                      <Badge variant="outline" className="text-xs">
                        Lot {lot.lot_number}: {lot.lot_name}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
