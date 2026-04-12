"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatPeso } from "@/components/shared/amount-display"
import type { PoItemWithPrItem } from "@/types/database"

interface PoItemsTableProps {
  items: PoItemWithPrItem[]
  showDeliveryProgress?: boolean
}

export function PoItemsTable({ items, showDeliveryProgress = false }: PoItemsTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">#</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="w-20">Unit</TableHead>
          <TableHead className="w-24 text-right">Qty</TableHead>
          <TableHead className="w-32 text-right">Unit Cost</TableHead>
          <TableHead className="w-32 text-right">Total</TableHead>
          {showDeliveryProgress && (
            <>
              <TableHead className="w-28 text-right">Delivered</TableHead>
              <TableHead className="w-28 text-right">Accepted</TableHead>
              <TableHead className="w-32">Progress</TableHead>
            </>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item, i) => {
          const qty = parseFloat(item.quantity)
          const delivered = parseFloat(item.delivered_quantity)
          const accepted = parseFloat(item.accepted_quantity)
          const progress = qty > 0 ? Math.round((delivered / qty) * 100) : 0

          return (
            <TableRow key={item.id}>
              <TableCell className="text-muted-foreground">{i + 1}</TableCell>
              <TableCell>
                <p className="font-medium">{item.description}</p>
                {item.remarks && (
                  <p className="text-xs text-muted-foreground">{item.remarks}</p>
                )}
              </TableCell>
              <TableCell>{item.unit}</TableCell>
              <TableCell className="text-right">{qty}</TableCell>
              <TableCell className="text-right">{formatPeso(parseFloat(item.unit_cost))}</TableCell>
              <TableCell className="text-right font-medium">
                {formatPeso(parseFloat(item.total_cost))}
              </TableCell>
              {showDeliveryProgress && (
                <>
                  <TableCell className="text-right">{delivered} / {qty}</TableCell>
                  <TableCell className="text-right">{accepted}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-8">{progress}%</span>
                    </div>
                  </TableCell>
                </>
              )}
            </TableRow>
          )
        })}
        <TableRow className="font-semibold">
          <TableCell colSpan={5} className="text-right">Total</TableCell>
          <TableCell className="text-right">
            {formatPeso(items.reduce((sum, item) => sum + parseFloat(item.total_cost), 0))}
          </TableCell>
          {showDeliveryProgress && <TableCell colSpan={3} />}
        </TableRow>
      </TableBody>
    </Table>
  )
}
