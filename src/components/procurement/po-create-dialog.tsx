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
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { createPurchaseOrder } from "@/lib/actions/purchase-orders"
import { formatPeso } from "@/components/shared/amount-display"

interface PoCreateDialogProps {
  procurementId: string
  procurementNumber: string
  supplierName: string
  contractAmount: string | null
  abcAmount: string
}

export function PoCreateDialog({
  procurementId,
  procurementNumber,
  supplierName,
  contractAmount,
  abcAmount,
}: PoCreateDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    setLoading(true)
    const result = await createPurchaseOrder({
      procurement_id: procurementId,
    })
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success("Purchase Order created successfully")
    setOpen(false)
    router.push(`/dashboard/procurement/purchase-orders/${result.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="mr-2 h-4 w-4" />
        Create Purchase Order
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Purchase Order</DialogTitle>
          <DialogDescription>
            Generate a Purchase Order from this awarded procurement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Procurement</span>
            <span className="font-medium">{procurementNumber}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Awarded Supplier</span>
            <span className="font-medium">{supplierName}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Contract Amount</span>
            <span className="font-medium">
              {formatPeso(parseFloat(contractAmount ?? abcAmount))}
            </span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Line items will be auto-populated from the awarded bid. You can review the PO before submitting for approval.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "Creating..." : "Create PO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
