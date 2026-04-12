"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Trophy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AmountDisplay } from "@/components/shared/amount-display"
import { awardProcurement } from "@/lib/actions/procurement-activities"

interface RecommendAwardButtonProps {
  procurementId: string
  bidId: string
  supplierName: string
  bidAmount: string
  isAlreadyAwarded: boolean
}

export function RecommendAwardButton({
  procurementId,
  bidId,
  supplierName,
  bidAmount,
  isAlreadyAwarded,
}: RecommendAwardButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    const result = await awardProcurement({
      procurement_id: procurementId,
      bid_id: bidId,
    })
    setBusy(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success(`Award recommended to ${supplierName}`)
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={isAlreadyAwarded ? "outline" : "default"}
        onClick={() => setOpen(true)}
        disabled={isAlreadyAwarded}
        title={isAlreadyAwarded ? "Already recommended for award" : "Recommend this bid for award"}
      >
        <Trophy className="mr-1 h-3.5 w-3.5" />
        {isAlreadyAwarded ? "Awarded" : "Recommend Award"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recommend Award</DialogTitle>
            <DialogDescription>
              Confirm that this bid is the Lowest Calculated Responsive Bid (LCRB) and the BAC recommends
              awarding the contract to this supplier. The Schools Division Superintendent will then approve the award.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Supplier</span>
              <span className="font-medium">{supplierName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bid Amount</span>
              <AmountDisplay amount={bidAmount} className="font-semibold" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={busy}>
              {busy ? "Recommending…" : "Confirm Recommendation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
