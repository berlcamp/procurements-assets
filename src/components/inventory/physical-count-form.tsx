"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import { CheckCircle } from "lucide-react"
import { recordPhysicalCount } from "@/lib/actions/inventory"
import type { InventoryWithDetails } from "@/types/database"

interface PhysicalCountFormProps {
  inventory: InventoryWithDetails[]
}

interface CountEntry {
  inventoryId: string
  countedQty: string
}

interface CountResult {
  itemName: string
  systemQty: number
  countedQty: number
  variance: number
}

export function PhysicalCountForm({ inventory }: PhysicalCountFormProps) {
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<CountResult[] | null>(null)

  function handleCountChange(inventoryId: string, value: string) {
    setCounts((prev) => ({ ...prev, [inventoryId]: value }))
  }

  function getVariance(inv: InventoryWithDetails): number | null {
    const counted = counts[inv.id]
    if (!counted || counted === "") return null
    return parseFloat(counted) - parseFloat(inv.current_quantity)
  }

  async function handleSubmit() {
    // Collect entries with values
    const entries: CountEntry[] = Object.entries(counts)
      .filter(([, val]) => val !== "" && !isNaN(parseFloat(val)))
      .map(([id, val]) => ({ inventoryId: id, countedQty: val }))

    if (entries.length === 0) {
      toast.error("Please enter at least one counted quantity")
      return
    }

    setSubmitting(true)
    const countResults: CountResult[] = []
    let errorCount = 0

    for (const entry of entries) {
      const inv = inventory.find((i) => i.id === entry.inventoryId)
      const result = await recordPhysicalCount({
        inventory_id: entry.inventoryId,
        counted_quantity: parseFloat(entry.countedQty),
        remarks: "Physical count",
      })

      if (result.error) {
        toast.error(`Error for ${inv?.item_catalog?.name}: ${result.error}`)
        errorCount++
      } else {
        countResults.push({
          itemName: inv?.item_catalog?.name ?? "Unknown",
          systemQty: parseFloat(inv?.current_quantity ?? "0"),
          countedQty: parseFloat(entry.countedQty),
          variance: result.variance ?? 0,
        })
      }
    }

    setSubmitting(false)

    if (countResults.length > 0) {
      setResults(countResults)
      if (errorCount === 0) {
        toast.success(`Physical count completed for ${countResults.length} item(s)`)
      } else {
        toast.warning(`Completed ${countResults.length} items, ${errorCount} errors`)
      }
    }
  }

  // Show results summary after submission
  if (results) {
    const itemsWithVariance = results.filter((r) => r.variance !== 0)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Physical Count Complete
          </CardTitle>
          <CardDescription>
            {results.length} item(s) counted, {itemsWithVariance.length} with variance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">System Qty</TableHead>
                <TableHead className="text-right">Counted Qty</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.itemName}</TableCell>
                  <TableCell className="text-right font-mono">
                    {r.systemQty.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {r.countedQty.toLocaleString()}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono font-medium ${
                      r.variance > 0
                        ? "text-green-600"
                        : r.variance < 0
                          ? "text-red-600"
                          : ""
                    }`}
                  >
                    {r.variance > 0 ? "+" : ""}
                    {r.variance.toLocaleString()}
                    {r.variance !== 0 && (
                      <Badge
                        variant="outline"
                        className={`ml-2 ${
                          r.variance > 0
                            ? "text-green-600 border-green-300"
                            : "text-red-600 border-red-300"
                        }`}
                      >
                        {r.variance > 0 ? "Surplus" : "Shortage"}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setResults(null)
                setCounts({})
              }}
            >
              Start New Count
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enter Counts</CardTitle>
        <CardDescription>
          Enter the physically counted quantity for each item. Only items with
          entered values will be submitted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {inventory.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No inventory records found for your office.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Office</TableHead>
                  <TableHead className="text-right">System Qty</TableHead>
                  <TableHead className="text-right">Counted Qty</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.map((inv) => {
                  const variance = getVariance(inv)
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm">
                        {inv.item_catalog?.code ?? "—"}
                      </TableCell>
                      <TableCell className="font-medium">
                        {inv.item_catalog?.name ?? "Unknown"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {inv.office?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(inv.current_quantity).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-28 ml-auto text-right font-mono"
                          value={counts[inv.id] ?? ""}
                          onChange={(e) => handleCountChange(inv.id, e.target.value)}
                          placeholder="—"
                        />
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono font-medium ${
                          variance === null
                            ? "text-muted-foreground"
                            : variance > 0
                              ? "text-green-600"
                              : variance < 0
                                ? "text-red-600"
                                : ""
                        }`}
                      >
                        {variance === null
                          ? "—"
                          : variance > 0
                            ? `+${variance.toLocaleString()}`
                            : variance.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <div className="flex justify-end mt-4">
              <Button
                onClick={handleSubmit}
                disabled={submitting || Object.keys(counts).length === 0}
              >
                {submitting ? "Submitting..." : "Submit Count"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
