import { notFound } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getInventoryById, getStockMovements } from "@/lib/actions/inventory"
import { ITEM_CATEGORY_LABELS, MOVEMENT_TYPE_LABELS, REFERENCE_TYPE_LABELS } from "@/lib/schemas/inventory"
import { format } from "date-fns"
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from "lucide-react"
import type { MovementType } from "@/types/database"

const MOVEMENT_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  stock_in: "default",
  transfer_in: "default",
  return: "default",
  stock_out: "destructive",
  transfer_out: "destructive",
  adjustment: "secondary",
}

function MovementIcon({ type }: { type: MovementType }) {
  if (["stock_in", "transfer_in", "return"].includes(type)) {
    return <TrendingUp className="h-3 w-3 text-green-600" />
  }
  if (["stock_out", "transfer_out"].includes(type)) {
    return <TrendingDown className="h-3 w-3 text-red-600" />
  }
  return <Minus className="h-3 w-3 text-muted-foreground" />
}

function formatQuantityDelta(type: MovementType, quantity: string): string {
  const qty = parseFloat(quantity)
  if (["stock_in", "transfer_in", "return"].includes(type)) {
    return `+${qty.toLocaleString()}`
  }
  if (["stock_out", "transfer_out"].includes(type)) {
    return `-${qty.toLocaleString()}`
  }
  // Adjustment — signed
  return qty >= 0 ? `+${qty.toLocaleString()}` : qty.toLocaleString()
}

export default async function StockCardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [inventory, movements] = await Promise.all([
    getInventoryById(id),
    getStockMovements(id),
  ])

  if (!inventory) return notFound()

  // Calculate running balance (movements are ordered desc, so work backwards)
  const currentQty = parseFloat(inventory.current_quantity)
  let runningBalance = currentQty
  const movementsWithBalance = movements.map((m) => {
    const balance = runningBalance
    const qty = parseFloat(m.quantity)
    // Reverse the effect to find the previous balance
    if (["stock_in", "transfer_in", "return"].includes(m.movement_type)) {
      runningBalance -= Math.abs(qty)
    } else if (["stock_out", "transfer_out"].includes(m.movement_type)) {
      runningBalance += Math.abs(qty)
    } else {
      // adjustment
      runningBalance -= qty
    }
    return { ...m, balance }
  })

  const reorderPoint = parseFloat(inventory.reorder_point)
  const isLow = reorderPoint > 0 && currentQty <= reorderPoint

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/dashboard/assets/inventory" />}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Inventory
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Stock Card: {inventory.item_catalog?.name ?? "Unknown Item"}
          </h1>
          <p className="text-muted-foreground">
            {inventory.item_catalog?.code} &middot; {inventory.office?.name ?? "Unknown Office"}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content: Movement ledger */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Stock Movements</CardTitle>
            </CardHeader>
            <CardContent>
              {movementsWithBalance.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No movements recorded yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Remarks</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movementsWithBalance.map((m) => {
                      const isPositive = ["stock_in", "transfer_in", "return"].includes(m.movement_type) ||
                        (m.movement_type === "adjustment" && parseFloat(m.quantity) >= 0)
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {format(new Date(m.created_at), "MMM d, yyyy HH:mm")}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <MovementIcon type={m.movement_type} />
                              <Badge variant={MOVEMENT_BADGE_VARIANT[m.movement_type] ?? "outline"}>
                                {MOVEMENT_TYPE_LABELS[m.movement_type] ?? m.movement_type}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className={`text-right font-mono font-medium ${isPositive ? "text-green-600" : "text-red-600"}`}>
                            {formatQuantityDelta(m.movement_type, m.quantity)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {m.balance.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {m.reference_type
                              ? (REFERENCE_TYPE_LABELS[m.reference_type] ?? m.reference_type)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                            {m.remarks ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {m.created_by_profile
                              ? `${m.created_by_profile.first_name} ${m.created_by_profile.last_name}`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: Summary */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Item Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Code</span>
                <span className="font-mono text-sm">{inventory.item_catalog?.code ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Name</span>
                <span className="text-sm font-medium">{inventory.item_catalog?.name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Category</span>
                <Badge variant="secondary">
                  {ITEM_CATEGORY_LABELS[inventory.item_catalog?.category ?? ""] ?? "—"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Unit</span>
                <span className="text-sm">{inventory.item_catalog?.unit ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Office</span>
                <span className="text-sm">{inventory.office?.name ?? "—"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stock Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Current Quantity</span>
                <span className={`text-lg font-bold font-mono ${isLow ? "text-orange-600" : ""}`}>
                  {currentQty.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Reorder Point</span>
                <span className="font-mono text-sm">
                  {reorderPoint > 0 ? reorderPoint.toLocaleString() : "Not set"}
                </span>
              </div>
              {isLow && (
                <Badge variant="outline" className="w-full justify-center text-orange-600 border-orange-300">
                  Below Reorder Point
                </Badge>
              )}
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Location</span>
                <span className="text-sm">{inventory.location ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Last Count</span>
                <span className="text-sm">
                  {inventory.last_count_date
                    ? format(new Date(inventory.last_count_date), "MMM d, yyyy")
                    : "Never"}
                </span>
              </div>
              {inventory.last_count_quantity !== null && (
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Last Count Qty</span>
                  <span className="font-mono text-sm">
                    {parseFloat(inventory.last_count_quantity).toLocaleString()}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
