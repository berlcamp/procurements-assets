"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "sonner"
import { completeInspection } from "@/lib/actions/purchase-orders"
import type { DeliveryItemWithPoItem } from "@/types/database"

interface DeliveryInspectionFormProps {
  deliveryId: string
  deliveryNumber: string
  items: DeliveryItemWithPoItem[]
}

export function DeliveryInspectionForm({
  deliveryId,
  deliveryNumber,
  items,
}: DeliveryInspectionFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [reportNumber, setReportNumber] = useState("")
  const [remarks, setRemarks] = useState("")
  const [results, setResults] = useState<
    Record<string, { accepted: string; rejected: string; reason: string }>
  >(() =>
    Object.fromEntries(
      items.map(item => [
        item.id,
        {
          accepted: item.quantity_delivered,
          rejected: "0",
          reason: "",
        },
      ])
    )
  )

  function updateResult(
    itemId: string,
    field: "accepted" | "rejected" | "reason",
    value: string
  ) {
    setResults(prev => {
      const current = prev[itemId]
      const updated = { ...current, [field]: value }

      // Auto-adjust: when accepted changes, set rejected = delivered - accepted
      if (field === "accepted") {
        const delivered = parseFloat(
          items.find(i => i.id === itemId)?.quantity_delivered ?? "0"
        )
        const accepted = parseFloat(value || "0")
        updated.rejected = String(Math.max(0, delivered - accepted))
      }
      // When rejected changes, set accepted = delivered - rejected
      if (field === "rejected") {
        const delivered = parseFloat(
          items.find(i => i.id === itemId)?.quantity_delivered ?? "0"
        )
        const rejected = parseFloat(value || "0")
        updated.accepted = String(Math.max(0, delivered - rejected))
      }

      return { ...prev, [itemId]: updated }
    })
  }

  async function handleSubmit() {
    const inspectionResults = items.map(item => ({
      delivery_item_id: item.id,
      quantity_accepted: parseFloat(results[item.id]?.accepted ?? "0"),
      quantity_rejected: parseFloat(results[item.id]?.rejected ?? "0"),
      rejection_reason: results[item.id]?.reason || null,
    }))

    // Validate accepted + rejected = delivered for each item
    for (const r of inspectionResults) {
      const item = items.find(i => i.id === r.delivery_item_id)!
      const delivered = parseFloat(item.quantity_delivered)
      if (r.quantity_accepted + r.quantity_rejected !== delivered) {
        toast.error(
          `Accepted + Rejected must equal delivered (${delivered}) for "${item.po_item?.description ?? "item"}"`
        )
        return
      }
      if (r.quantity_rejected > 0 && !r.rejection_reason) {
        toast.error(
          `Please provide a rejection reason for "${item.po_item?.description ?? "item"}"`
        )
        return
      }
    }

    setLoading(true)
    const result = await completeInspection({
      delivery_id: deliveryId,
      results: inspectionResults,
      inspection_report_number: reportNumber || null,
      remarks: remarks || null,
    })
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success("Inspection completed successfully")
    router.refresh()
  }

  function handleAcceptAll() {
    setResults(prev => {
      const next = { ...prev }
      items.forEach(item => {
        next[item.id] = {
          accepted: item.quantity_delivered,
          rejected: "0",
          reason: "",
        }
      })
      return next
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Inspection & Acceptance</CardTitle>
            <CardDescription>
              Record inspection results for {deliveryNumber}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleAcceptAll}>
            Accept All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="w-20">Unit</TableHead>
              <TableHead className="w-24 text-right">Delivered</TableHead>
              <TableHead className="w-28">Accepted</TableHead>
              <TableHead className="w-28">Rejected</TableHead>
              <TableHead>Rejection Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(item => {
              const r = results[item.id]
              return (
                <TableRow key={item.id}>
                  <TableCell className="text-sm font-medium">
                    {item.po_item?.description ?? "—"}
                  </TableCell>
                  <TableCell>{item.po_item?.unit ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {parseFloat(item.quantity_delivered)}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      max={parseFloat(item.quantity_delivered)}
                      step="any"
                      value={r?.accepted ?? ""}
                      onChange={e =>
                        updateResult(item.id, "accepted", e.target.value)
                      }
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      max={parseFloat(item.quantity_delivered)}
                      step="any"
                      value={r?.rejected ?? ""}
                      onChange={e =>
                        updateResult(item.id, "rejected", e.target.value)
                      }
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell>
                    {parseFloat(r?.rejected ?? "0") > 0 && (
                      <Input
                        value={r?.reason ?? ""}
                        onChange={e =>
                          updateResult(item.id, "reason", e.target.value)
                        }
                        placeholder="Reason..."
                        className="w-full"
                      />
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Inspection Report Number (optional)</Label>
            <Input
              value={reportNumber}
              onChange={e => setReportNumber(e.target.value)}
              placeholder="IAR-2026-001"
            />
          </div>
          <div className="space-y-2">
            <Label>Remarks (optional)</Label>
            <Textarea
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Inspection notes..."
              rows={2}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Submitting..." : "Complete Inspection"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
