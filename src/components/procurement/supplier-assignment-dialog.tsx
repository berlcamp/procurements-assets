"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { UserCheck } from "lucide-react"
import { toast } from "sonner"
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
import { AmountDisplay } from "@/components/shared/amount-display"
import {
  setProcurementSupplier,
  getActiveSuppliersForBid,
} from "@/lib/actions/procurement-activities"

interface SupplierAssignmentDialogProps {
  procurementId: string
  abcAmount: string
  currentSupplierId: string | null
  currentSupplierName: string | null
  currentContractAmount: string | null
}

export function SupplierAssignmentDialog({
  procurementId,
  abcAmount,
  currentSupplierId,
  currentSupplierName,
  currentContractAmount,
}: SupplierAssignmentDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; tin: string | null }>>([])
  const [supplierId, setSupplierId] = useState(currentSupplierId ?? "")
  const [contractAmount, setContractAmount] = useState(currentContractAmount ?? "")

  useEffect(() => {
    if (open) {
      getActiveSuppliersForBid().then(data =>
        setSuppliers(data.map(s => ({ id: s.id, name: s.name, tin: s.tin ?? null })))
      )
    }
  }, [open])

  async function handleSubmit() {
    if (!supplierId) {
      toast.error("Please select a supplier")
      return
    }
    if (!contractAmount || parseFloat(contractAmount) <= 0) {
      toast.error("Contract amount must be greater than zero")
      return
    }
    setLoading(true)
    const result = await setProcurementSupplier({
      procurement_id: procurementId,
      supplier_id: supplierId,
      contract_amount: contractAmount,
    })
    setLoading(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Supplier assigned")
    setOpen(false)
    router.refresh()
  }

  const isUpdate = !!currentSupplierId

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button size="sm" variant={isUpdate ? "outline" : "default"}>
          <UserCheck className="mr-1 h-4 w-4" />
          {isUpdate ? "Change Supplier" : "Assign Supplier"}
        </Button>
      } />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isUpdate ? "Change Assigned Supplier" : "Assign Supplier"}</DialogTitle>
          <DialogDescription>
            Select the supplier and enter the contract amount for this procurement.
            The contract amount cannot exceed the Approved Budget for the Contract.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {isUpdate && (
            <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              Currently assigned: <strong>{currentSupplierName}</strong> ·{" "}
              <AmountDisplay amount={currentContractAmount ?? "0"} />
            </div>
          )}

          <div className="space-y-1">
            <Label>Supplier</Label>
            <select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select a supplier...</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.tin ? ` (TIN: ${s.tin})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Contract Amount (₱)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={contractAmount}
              onChange={e => setContractAmount(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground">
              ABC: <AmountDisplay amount={abcAmount} />
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Saving..." : isUpdate ? "Update" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
