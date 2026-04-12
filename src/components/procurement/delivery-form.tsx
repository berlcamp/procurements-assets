"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import { toast } from "sonner"
import { Truck } from "lucide-react"
import { recordDelivery } from "@/lib/actions/purchase-orders"
import type { PoItemWithPrItem } from "@/types/database"

interface DeliveryFormProps {
  poId: string
  poNumber: string
  items: PoItemWithPrItem[]
}

export function DeliveryForm({ poId, poNumber, items }: DeliveryFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deliveryDate, setDeliveryDate] = useState(
    new Date().toISOString().split("T")[0]
  )
  const [remarks, setRemarks] = useState("")
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map(item => {
        const remaining = parseFloat(item.quantity) - parseFloat(item.delivered_quantity)
        return [item.id, remaining > 0 ? String(remaining) : "0"]
      })
    )
  )

  const deliverableItems = items.filter(item => {
    const remaining = parseFloat(item.quantity) - parseFloat(item.delivered_quantity)
    return remaining > 0
  })

  if (deliverableItems.length === 0) return null

  async function handleSubmit() {
    const deliveryItems = deliverableItems
      .filter(item => parseFloat(quantities[item.id] || "0") > 0)
      .map(item => ({
        po_item_id: item.id,
        quantity_delivered: parseFloat(quantities[item.id] || "0"),
      }))

    if (deliveryItems.length === 0) {
      toast.error("Enter delivery quantities for at least one item")
      return
    }

    // Validate quantities
    for (const di of deliveryItems) {
      const item = items.find(i => i.id === di.po_item_id)!
      const remaining = parseFloat(item.quantity) - parseFloat(item.delivered_quantity)
      if (di.quantity_delivered > remaining) {
        toast.error(`Quantity exceeds remaining for "${item.description}"`)
        return
      }
    }

    setLoading(true)
    const result = await recordDelivery({
      purchase_order_id: poId,
      delivery_date: deliveryDate,
      items: deliveryItems,
      remarks: remarks || null,
    })
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success("Delivery recorded successfully")
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Truck className="mr-2 h-4 w-4" />
        Record Delivery
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record Delivery</DialogTitle>
          <DialogDescription>
            Record received items for {poNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Delivery Date</Label>
            <Input
              type="date"
              value={deliveryDate}
              onChange={e => setDeliveryDate(e.target.value)}
            />
          </div>

          <div>
            <Label className="mb-2 block">Items Received</Label>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-20">Unit</TableHead>
                  <TableHead className="w-24 text-right">Ordered</TableHead>
                  <TableHead className="w-24 text-right">Remaining</TableHead>
                  <TableHead className="w-28">Qty Delivered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliverableItems.map(item => {
                  const remaining = parseFloat(item.quantity) - parseFloat(item.delivered_quantity)
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm">{item.description}</TableCell>
                      <TableCell>{item.unit}</TableCell>
                      <TableCell className="text-right">{parseFloat(item.quantity)}</TableCell>
                      <TableCell className="text-right">{remaining}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          max={remaining}
                          step="any"
                          value={quantities[item.id] || ""}
                          onChange={e => setQuantities(prev => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))}
                          className="w-24"
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-2">
            <Label>Remarks (optional)</Label>
            <Textarea
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Delivery notes, conditions, etc."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Recording..." : "Record Delivery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
