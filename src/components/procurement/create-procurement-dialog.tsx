"use client"

import { useState } from "react"
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
import { AmountDisplay } from "@/components/shared/amount-display"
import { toast } from "sonner"
import {
  getApprovedPrsForProcurement,
  createProcurementActivity,
} from "@/lib/actions/procurement-activities"
import type { PurchaseRequestWithDetails } from "@/types/database"

export function CreateProcurementDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [prs, setPrs] = useState<PurchaseRequestWithDetails[]>([])
  const [selectedPrId, setSelectedPrId] = useState("")
  const [method, setMethod] = useState<"svp" | "shopping">("svp")
  const router = useRouter()

  async function handleOpen(isOpen: boolean) {
    setOpen(isOpen)
    if (isOpen) {
      const data = await getApprovedPrsForProcurement()
      setPrs(data)
      setSelectedPrId("")
      setMethod("svp")
    }
  }

  const selectedPr = prs.find(p => p.id === selectedPrId)

  async function handleSubmit() {
    if (!selectedPrId) {
      toast.error("Please select a Purchase Request")
      return
    }
    setLoading(true)
    const result = await createProcurementActivity({
      purchase_request_id: selectedPrId,
      procurement_method: method,
    })
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success("Procurement activity created")
    setOpen(false)
    router.push(`/dashboard/procurement/activities/${result.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-1.5 h-4 w-4" />
        New Activity
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Procurement Activity</DialogTitle>
          <DialogDescription>
            Select an approved Purchase Request and procurement method.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* PR Selector */}
          <div className="space-y-2">
            <Label>Purchase Request</Label>
            {prs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No approved PRs available for procurement.</p>
            ) : (
              <select
                value={selectedPrId}
                onChange={e => setSelectedPrId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a PR...</option>
                {prs.map(pr => (
                  <option key={pr.id} value={pr.id}>
                    {pr.pr_number} — {pr.app_item?.general_description?.slice(0, 40) ?? pr.purpose.slice(0, 40)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* PR Details Preview */}
          {selectedPr && (
            <div className="rounded-md border p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">PR Number</span>
                <span className="font-mono">{selectedPr.pr_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Office</span>
                <span>{selectedPr.office?.name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Amount</span>
                <AmountDisplay amount={selectedPr.total_estimated_cost} className="font-semibold" />
              </div>
              {selectedPr.app_item && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">APP Item</span>
                  <span className="text-right max-w-[200px] truncate">
                    {selectedPr.app_item.general_description}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Method Selector */}
          <div className="space-y-2">
            <Label>Procurement Method</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="method"
                  value="svp"
                  checked={method === "svp"}
                  onChange={() => setMethod("svp")}
                  className="accent-primary"
                />
                <span className="text-sm">Small Value Procurement (SVP)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="method"
                  value="shopping"
                  checked={method === "shopping"}
                  onChange={() => setMethod("shopping")}
                  className="accent-primary"
                />
                <span className="text-sm">Shopping</span>
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading || !selectedPrId}>
            {loading ? "Creating..." : "Create Activity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
