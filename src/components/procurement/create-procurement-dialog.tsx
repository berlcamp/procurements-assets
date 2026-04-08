"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Plus } from "lucide-react"
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
import { checkSplitContract } from "@/lib/actions/procurement"
import type { PurchaseRequestWithDetails, SplitContractWarning } from "@/types/database"

export function CreateProcurementDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [prs, setPrs] = useState<PurchaseRequestWithDetails[]>([])
  const [selectedPrId, setSelectedPrId] = useState("")
  const [method, setMethod] = useState<"svp" | "shopping">("svp")
  const [splitWarning, setSplitWarning] = useState<SplitContractWarning | null>(null)
  const router = useRouter()

  async function handleOpen(isOpen: boolean) {
    setOpen(isOpen)
    if (isOpen) {
      const data = await getApprovedPrsForProcurement()
      setPrs(data)
      setSelectedPrId("")
      setMethod("svp")
      setSplitWarning(null)
    }
  }

  const selectedPr = prs.find(p => p.id === selectedPrId)

  // Default the method to the PR's procurement_mode when it matches svp/shopping
  useEffect(() => {
    if (!selectedPr) return
    const planned = selectedPr.procurement_mode?.toLowerCase().trim()
    if (planned === "svp") setMethod("svp")
    else if (planned === "shopping") setMethod("shopping")
  }, [selectedPr])

  useEffect(() => {
    if (!selectedPr) {
      setSplitWarning(null)
      return
    }
    let cancelled = false
    const officeId = selectedPr.office_id
    const firstItemCategory = selectedPr.pr_items?.find(i => i.app_item)?.app_item?.project_type
    const category = firstItemCategory ?? "goods"
    const amount = parseFloat(selectedPr.total_estimated_cost) || 0
    if (!officeId || amount <= 0) {
      setSplitWarning(null)
      return
    }
    checkSplitContract(officeId, category, amount).then(result => {
      if (!cancelled) setSplitWarning(result)
    })
    return () => {
      cancelled = true
    }
  }, [selectedPr])

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
                    {pr.pr_number} — {pr.purpose.slice(0, 50)}
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
              {selectedPr.pr_items && selectedPr.pr_items.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bundled Items</span>
                  <span className="font-medium">{selectedPr.pr_items.length}</span>
                </div>
              )}
              {selectedPr.procurement_mode && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Planned Mode</span>
                  <span className="font-medium capitalize">{selectedPr.procurement_mode.replace(/_/g, " ")}</span>
                </div>
              )}
            </div>
          )}

          {/* Planned-mode mismatch warning */}
          {selectedPr?.procurement_mode &&
            (() => {
              const planned = selectedPr.procurement_mode.toLowerCase().trim()
              if (planned !== method && (planned === "svp" || planned === "shopping")) {
                return (
                  <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>
                      This PR was planned under{" "}
                      <span className="font-semibold capitalize">{planned.replace(/_/g, " ")}</span> but you
                      selected <span className="font-semibold">{method.toUpperCase()}</span>. Make sure the
                      change is justified.
                    </p>
                  </div>
                )
              }
              return null
            })()}

          {/* Split-contract advisory */}
          {splitWarning?.warning && (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Possible contract splitting</p>
                <p className="text-xs">
                  This office has{" "}
                  <span className="font-semibold">{splitWarning.pr_count}</span> recent PR(s) in this category
                  totaling <AmountDisplay amount={splitWarning.cumulative_amount} className="font-semibold" />,
                  exceeding the threshold of{" "}
                  <AmountDisplay amount={splitWarning.threshold} className="font-semibold" />. Review whether
                  these should be consolidated under a single competitive method.
                </p>
              </div>
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
