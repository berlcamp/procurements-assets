"use client"

import { useState } from "react"
import { toast } from "sonner"
import { deletePpmpItem } from "@/lib/actions/ppmp"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { Trash2Icon, PlusIcon } from "lucide-react"
import { PPMP_ITEM_CATEGORY_LABELS } from "@/lib/schemas/ppmp"
import type { PpmpItemWithAllocation } from "@/types/database"

interface PpmpItemTableProps {
  items: PpmpItemWithAllocation[]
  editable?: boolean
  onAddItem?: () => void
  onItemDeleted?: () => void
}

export function PpmpItemTable({
  items,
  editable = false,
  onAddItem,
  onItemDeleted,
}: PpmpItemTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(id: string) {
    setDeletingId(id)
    const result = await deletePpmpItem(id)
    setDeletingId(null)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Item removed.")
    onItemDeleted?.()
  }

  const total = items.reduce((sum, i) => sum + parseFloat(i.estimated_total_cost), 0)

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit Cost</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
              <TableHead>Method</TableHead>
              {editable && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={editable ? 9 : 8} className="py-8 text-center text-muted-foreground text-sm">
                  No items yet. Add procurement items below.
                </TableCell>
              </TableRow>
            )}
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-xs">{item.item_number}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs whitespace-nowrap">
                    {PPMP_ITEM_CATEGORY_LABELS[item.category] ?? item.category}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <p className="truncate text-sm">{item.description}</p>
                  {item.is_cse && (
                    <span className="text-xs text-muted-foreground">DBM-PS</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{item.unit}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {parseFloat(item.quantity).toLocaleString("en-PH", { maximumFractionDigits: 4 })}
                </TableCell>
                <TableCell className="text-right">
                  <AmountDisplay amount={item.estimated_unit_cost} />
                </TableCell>
                <TableCell className="text-right">
                  <AmountDisplay amount={item.estimated_total_cost} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {item.procurement_method}
                </TableCell>
                {editable && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      disabled={deletingId === item.id}
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Total row */}
      <div className="flex justify-end">
        <div className="flex items-center gap-3 rounded-md border px-4 py-2">
          <span className="text-sm font-medium text-muted-foreground">Total Estimated Cost:</span>
          <AmountDisplay amount={total} className="text-base font-semibold" />
        </div>
      </div>

      {editable && onAddItem && (
        <Button variant="outline" size="sm" onClick={onAddItem}>
          <PlusIcon className="mr-1.5 h-4 w-4" />
          Add Item
        </Button>
      )}
    </div>
  )
}
