"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/status-badge"
import { formatPeso } from "@/components/shared/amount-display"
import { PO_STATUS_LABELS } from "@/lib/schemas/procurement"
import { format } from "date-fns"
import { ExternalLink } from "lucide-react"

interface PoSummaryDialogProps {
  po: {
    id: string
    po_number: string
    status: string
    total_amount: string
    delivery_date: string | null
    delivery_address: string | null
    payment_terms: string | null
    approved_at: string | null
    issued_at: string | null
    created_at: string
    supplier: { id: string; name: string; trade_name: string | null; tin: string } | null
    office: { id: string; name: string; code: string } | null
    po_items: {
      id: string
      description: string
      unit: string
      quantity: string
      unit_cost: string
      total_cost: string
      delivered_quantity: string
      accepted_quantity: string
    }[]
  }
}

export function PoSummaryDialog({ po }: PoSummaryDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="w-full" />}>
        View Purchase Order
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <DialogTitle>{po.po_number}</DialogTitle>
            <StatusBadge status={po.status} />
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* PO Details */}
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{PO_STATUS_LABELS[po.status] ?? po.status}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total Amount</dt>
              <dd className="font-semibold">{formatPeso(parseFloat(po.total_amount))}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Supplier</dt>
              <dd className="font-medium">{po.supplier?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Office</dt>
              <dd>{po.office?.name ?? "—"}</dd>
            </div>
            {po.delivery_date && (
              <div>
                <dt className="text-muted-foreground">Delivery Date</dt>
                <dd>{format(new Date(po.delivery_date), "MMM d, yyyy")}</dd>
              </div>
            )}
            {po.payment_terms && (
              <div>
                <dt className="text-muted-foreground">Payment Terms</dt>
                <dd>{po.payment_terms}</dd>
              </div>
            )}
            {po.delivery_address && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Delivery Address</dt>
                <dd>{po.delivery_address}</dd>
              </div>
            )}
            {po.approved_at && (
              <div>
                <dt className="text-muted-foreground">Approved</dt>
                <dd>{format(new Date(po.approved_at), "MMM d, yyyy h:mm a")}</dd>
              </div>
            )}
            {po.issued_at && (
              <div>
                <dt className="text-muted-foreground">Issued</dt>
                <dd>{format(new Date(po.issued_at), "MMM d, yyyy h:mm a")}</dd>
              </div>
            )}
          </dl>

          {/* Line Items */}
          {po.po_items.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Line Items ({po.po_items.length})</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-16">Unit</TableHead>
                    <TableHead className="w-16 text-right">Qty</TableHead>
                    <TableHead className="w-28 text-right">Unit Cost</TableHead>
                    <TableHead className="w-28 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {po.po_items.map((item, i) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-sm">{item.description}</TableCell>
                      <TableCell>{item.unit}</TableCell>
                      <TableCell className="text-right">{parseFloat(item.quantity)}</TableCell>
                      <TableCell className="text-right">{formatPeso(parseFloat(item.unit_cost))}</TableCell>
                      <TableCell className="text-right font-medium">{formatPeso(parseFloat(item.total_cost))}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell colSpan={5} className="text-right">Total</TableCell>
                    <TableCell className="text-right">{formatPeso(parseFloat(po.total_amount))}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* Link to full detail page */}
          <div className="pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              nativeButton={false}
              render={<Link href={`/dashboard/procurement/purchase-orders/${po.id}`} />}
            >
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Open Full PO Detail
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
