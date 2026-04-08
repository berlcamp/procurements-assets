import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatPeso } from "@/components/shared/amount-display"
import { cn } from "@/lib/utils"
import type { PrItem, BidWithDetails } from "@/types/database"

interface AbstractOfCanvassProps {
  prItems: PrItem[]
  bids: BidWithDetails[]
}

/**
 * Abstract of Canvass — pivoted comparison table.
 * Rows = PR items, Columns = Suppliers.
 * Highlights lowest responsive price per item in green.
 */
export function AbstractOfCanvass({ prItems, bids }: AbstractOfCanvassProps) {
  const activeBids = bids.filter(b => !b.deleted_at && b.status !== "disqualified")
  const filteredItems = prItems.filter(i => !i.deleted_at)

  if (activeBids.length === 0 || filteredItems.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No data for abstract.</p>
  }

  // Build a map: pr_item_id → { supplier_id → bid_item }
  const priceMap = new Map<string, Map<string, { unit_cost: number; total_cost: number; brand: string }>>()
  for (const bid of activeBids) {
    for (const item of bid.items ?? []) {
      if (!priceMap.has(item.pr_item_id)) {
        priceMap.set(item.pr_item_id, new Map())
      }
      priceMap.get(item.pr_item_id)!.set(bid.supplier_id, {
        unit_cost: parseFloat(item.offered_unit_cost),
        total_cost: parseFloat(item.offered_total_cost),
        brand: item.brand_model || "",
      })
    }
  }

  // Find lowest per item
  function isLowest(prItemId: string, supplierId: string): boolean {
    const suppliers = priceMap.get(prItemId)
    if (!suppliers) return false
    const prices = Array.from(suppliers.entries())
      .filter(([sid]) => {
        const bid = activeBids.find(b => b.supplier_id === sid)
        return bid?.is_responsive && bid?.is_eligible && bid?.is_compliant
      })
      .map(([, v]) => v.total_cost)
    if (prices.length === 0) return false
    const min = Math.min(...prices)
    const current = suppliers.get(supplierId)?.total_cost
    return current === min
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[40px]">#</TableHead>
            <TableHead className="min-w-[200px]">Description</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            {activeBids.map(bid => (
              <TableHead key={bid.id} className="text-center min-w-[140px]">
                <div className="text-xs font-semibold">{bid.supplier?.name ?? "—"}</div>
                {bid.status === "awarded" && (
                  <span className="text-[10px] text-green-700 font-bold">AWARDED</span>
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredItems.map((item, idx) => (
            <TableRow key={item.id}>
              <TableCell className="text-sm">{idx + 1}</TableCell>
              <TableCell className="text-sm">{item.description}</TableCell>
              <TableCell className="text-sm">{item.unit}</TableCell>
              <TableCell className="text-right text-sm">{item.quantity}</TableCell>
              {activeBids.map(bid => {
                const price = priceMap.get(item.id)?.get(bid.supplier_id)
                const lowest = price ? isLowest(item.id, bid.supplier_id) : false
                return (
                  <TableCell
                    key={bid.id}
                    className={cn(
                      "text-center text-sm",
                      lowest && "bg-green-50 font-medium text-green-800"
                    )}
                  >
                    {price ? (
                      <div>
                        <div className="font-mono text-xs">{formatPeso(price.unit_cost)}</div>
                        <div className="font-mono text-xs text-muted-foreground">{formatPeso(price.total_cost)}</div>
                        {price.brand && (
                          <div className="text-[10px] text-muted-foreground">{price.brand}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
          {/* Total row */}
          <TableRow className="font-semibold border-t-2">
            <TableCell colSpan={4} className="text-right text-sm">Total Bid Amount</TableCell>
            {activeBids.map(bid => (
              <TableCell key={bid.id} className="text-center">
                <span className="font-mono text-sm">{formatPeso(bid.bid_amount)}</span>
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}
