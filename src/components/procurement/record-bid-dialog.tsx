"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AmountDisplay, formatPeso } from "@/components/shared/amount-display"
import { toast } from "sonner"
import { getActiveSuppliersForBid, recordBid } from "@/lib/actions/procurement-activities"
import { BID_SECURITY_FORMS, BID_SECURITY_FORM_LABELS } from "@/lib/schemas/procurement"
import type { PrItem, Supplier } from "@/types/database"

interface RecordBidDialogProps {
  procurementId: string
  prItems: PrItem[]
  abcAmount: string
  requiresBidSecurity?: boolean
  bidSecurityMinAmount?: number
}

interface BidItemRow {
  pr_item_id: string
  description: string
  unit: string
  quantity: string
  offered_unit_cost: string
  offered_total_cost: string
  brand_model: string
  specifications: string
}

export function RecordBidDialog({ procurementId, prItems, abcAmount, requiresBidSecurity, bidSecurityMinAmount }: RecordBidDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<Pick<Supplier, "id" | "name" | "trade_name" | "tin">[]>([])
  const [selectedSupplierId, setSelectedSupplierId] = useState("")
  const [items, setItems] = useState<BidItemRow[]>([])
  const [bidSecurityAmount, setBidSecurityAmount] = useState("")
  const [bidSecurityForm, setBidSecurityForm] = useState("")
  const [bidSecurityReference, setBidSecurityReference] = useState("")
  const router = useRouter()

  useEffect(() => {
    if (open) {
      getActiveSuppliersForBid().then(setSuppliers)
      // Pre-populate from PR items
      setItems(
        prItems.filter(i => !i.deleted_at).map(item => ({
          pr_item_id: item.id,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          offered_unit_cost: "",
          offered_total_cost: "0",
          brand_model: "",
          specifications: "",
        }))
      )
      setSelectedSupplierId("")
      setBidSecurityAmount("")
      setBidSecurityForm("")
      setBidSecurityReference("")
    }
  }, [open, prItems])

  function updateItem(index: number, field: string, value: string) {
    setItems(prev => {
      const updated = [...prev]
      const item = { ...updated[index], [field]: value }
      // Recalculate total
      if (field === "offered_unit_cost") {
        const cost = parseFloat(value) || 0
        const qty = parseFloat(item.quantity) || 0
        item.offered_total_cost = (cost * qty).toFixed(2)
      }
      updated[index] = item
      return updated
    })
  }

  const totalBid = items.reduce((sum, item) => sum + (parseFloat(item.offered_total_cost) || 0), 0)
  const exceedsAbc = totalBid > parseFloat(abcAmount)

  async function handleSubmit() {
    if (!selectedSupplierId) {
      toast.error("Please select a supplier")
      return
    }
    const filledItems = items.filter(i => parseFloat(i.offered_unit_cost) > 0)
    if (filledItems.length === 0) {
      toast.error("Enter at least one item price")
      return
    }
    if (requiresBidSecurity) {
      if (!bidSecurityAmount || parseFloat(bidSecurityAmount) <= 0) {
        toast.error("Bid security amount is required")
        return
      }
      if (!bidSecurityForm) {
        toast.error("Bid security form is required")
        return
      }
    }

    setLoading(true)
    const result = await recordBid({
      procurement_id: procurementId,
      supplier_id: selectedSupplierId,
      items: filledItems.map(i => ({
        pr_item_id: i.pr_item_id,
        offered_unit_cost: i.offered_unit_cost,
        offered_total_cost: i.offered_total_cost,
        brand_model: i.brand_model || null,
        specifications: i.specifications || null,
        remarks: null,
      })),
      ...(requiresBidSecurity ? {
        bid_security_amount: bidSecurityAmount || null,
        bid_security_form: bidSecurityForm as typeof BID_SECURITY_FORMS[number] || null,
        bid_security_reference: bidSecurityReference || null,
      } : {}),
    })
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success("Bid recorded successfully")
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="mr-1 h-4 w-4" />
        Record Bid
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record Bid / Quotation</DialogTitle>
          <DialogDescription>
            Enter the supplier&apos;s offered prices for each item.
            ABC: {formatPeso(abcAmount)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Supplier Selector */}
          <div className="space-y-2">
            <Label>Supplier</Label>
            <select
              value={selectedSupplierId}
              onChange={e => setSelectedSupplierId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select a supplier...</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.tin ? `(${s.tin})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Bid Security (Competitive Bidding) */}
          {requiresBidSecurity && (
            <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/50 p-3">
              <Label className="text-sm font-medium">Bid Security (Required)</Label>
              {bidSecurityMinAmount != null && (
                <p className="text-xs text-muted-foreground">
                  Minimum: {formatPeso(bidSecurityMinAmount)} (2% of ABC)
                </p>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={bidSecurityAmount}
                    onChange={e => setBidSecurityAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Form</Label>
                  <select
                    value={bidSecurityForm}
                    onChange={e => setBidSecurityForm(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Select form...</option>
                    {BID_SECURITY_FORMS.map(f => (
                      <option key={f} value={f}>{BID_SECURITY_FORM_LABELS[f]}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Reference No.</Label>
                  <Input
                    value={bidSecurityReference}
                    onChange={e => setBidSecurityReference(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Bid Items Table */}
          <div className="space-y-2">
            <Label>Item Pricing</Label>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%]">Description</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Offered Unit Cost</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Brand/Model</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => (
                  <TableRow key={item.pr_item_id}>
                    <TableCell className="text-sm">{item.description}</TableCell>
                    <TableCell className="text-sm">{item.unit}</TableCell>
                    <TableCell className="text-right text-sm">{item.quantity}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.offered_unit_cost}
                        onChange={e => updateItem(idx, "offered_unit_cost", e.target.value)}
                        className="text-right w-28 ml-auto"
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {formatPeso(item.offered_total_cost)}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={item.brand_model}
                        onChange={e => updateItem(idx, "brand_model", e.target.value)}
                        className="w-28"
                        placeholder="Optional"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end gap-4 text-sm pt-2">
              <span className="text-muted-foreground">Total Bid:</span>
              <span className={`font-semibold font-mono ${exceedsAbc ? "text-red-600" : ""}`}>
                {formatPeso(totalBid)}
              </span>
            </div>
            {exceedsAbc && (
              <p className="text-xs text-red-600 text-right">
                Bid exceeds the Approved Budget for the Contract ({formatPeso(abcAmount)})
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading || !selectedSupplierId || exceedsAbc}>
            {loading ? "Recording..." : "Record Bid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
