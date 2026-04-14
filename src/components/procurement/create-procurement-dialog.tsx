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
import { PROCUREMENT_METHOD_LABELS } from "@/lib/schemas/procurement"
import type { PurchaseRequestWithDetails, SplitContractWarning } from "@/types/database"

export function CreateProcurementDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [prs, setPrs] = useState<PurchaseRequestWithDetails[]>([])
  const [selectedPrId, setSelectedPrId] = useState("")
  const [method, setMethod] = useState<string>("svp")
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

  // Default the method to the PR's planned procurement_mode when it matches a known method
  useEffect(() => {
    if (!selectedPr) return
    const planned = selectedPr.procurement_mode?.toLowerCase().trim().replace(/ /g, "_")
    if (planned && planned in PROCUREMENT_METHOD_LABELS) setMethod(planned)
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
      procurement_method: method as "svp" | "shopping" | "competitive_bidding" | "direct_contracting" | "repeat_order" | "emergency" | "negotiated" | "agency_to_agency",
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
              const planned = selectedPr.procurement_mode.toLowerCase().trim().replace(/ /g, "_")
              const normalizedPlanned = planned === "bidding" ? "competitive_bidding" : planned === "small_value" ? "svp" : planned
              if (normalizedPlanned !== method && normalizedPlanned) {
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

          {/* Split-contract advisory — only relevant for SVP/Shopping */}
          {splitWarning?.warning && method !== "competitive_bidding" && (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Possible contract splitting</p>
                <p className="text-xs">
                  {splitWarning.pr_count > 0 ? (
                    <>
                      This office has{" "}
                      <span className="font-semibold">{splitWarning.pr_count}</span> existing PR(s) in this
                      category. Including this request, the cumulative total is{" "}
                      <AmountDisplay amount={splitWarning.cumulative_amount} className="font-semibold" />,
                      exceeding the threshold of{" "}
                      <AmountDisplay amount={splitWarning.threshold} className="font-semibold" />.
                    </>
                  ) : (
                    <>
                      This request of{" "}
                      <AmountDisplay amount={splitWarning.cumulative_amount} className="font-semibold" />{" "}
                      already exceeds the{" "}
                      <AmountDisplay amount={splitWarning.threshold} className="font-semibold" />{" "}
                      threshold for this category.
                    </>
                  )}{" "}
                  Review whether this should use Competitive Bidding instead.
                </p>
              </div>
            </div>
          )}

          {/* Method Selector */}
          <div className="space-y-2">
            <Label>Procurement Method</Label>
            <select
              value={method}
              onChange={e => setMethod(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <optgroup label="Competitive Methods">
                <option value="svp">Small Value Procurement (SVP)</option>
                <option value="shopping">Shopping</option>
                <option value="competitive_bidding">Competitive Bidding</option>
              </optgroup>
              <optgroup label="Alternative Methods">
                <option value="direct_contracting">Direct Contracting</option>
                <option value="repeat_order">Repeat Order</option>
                <option value="emergency">Emergency Purchase</option>
                <option value="negotiated">Negotiated Procurement</option>
                <option value="agency_to_agency">Agency-to-Agency</option>
              </optgroup>
            </select>
            {method === "competitive_bidding" && (
              <p className="text-xs text-muted-foreground">
                For procurements above SVP/Shopping thresholds. Requires BAC evaluation, PhilGEPS publication, and full 17-step workflow.
              </p>
            )}
            {method === "direct_contracting" && (
              <p className="text-xs text-muted-foreground">
                For proprietary items or exclusive dealers. Requires written justification and BAC recommendation.
              </p>
            )}
            {method === "repeat_order" && (
              <p className="text-xs text-muted-foreground">
                Repeat of an existing contract within 6 months, with price increase ≤ 25%.
              </p>
            )}
            {method === "emergency" && (
              <p className="text-xs text-muted-foreground">
                For imminent danger or calamity. Purchase first, documentation post-facto within 30 days.
              </p>
            )}
            {method === "negotiated" && (
              <p className="text-xs text-muted-foreground">
                Requires 2 prior failed biddings on this PR. BAC negotiates terms with supplier.
              </p>
            )}
            {method === "agency_to_agency" && (
              <p className="text-xs text-muted-foreground">
                Procurement from another government agency. Requires MOA/MOU. No BAC required.
              </p>
            )}
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
