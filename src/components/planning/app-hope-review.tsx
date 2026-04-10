"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { CheckCircle2, MessageSquareWarning, Eye } from "lucide-react"
import { hopeReviewAppItem, hopeBatchReviewAppItems } from "@/lib/actions/app"
import { useRouter } from "next/navigation"
import { format, parseISO } from "date-fns"
import type { AppItemWithOffice } from "@/types/database"

interface AppHopeReviewProps {
  items: AppItemWithOffice[]
  appId: string
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  try { return format(parseISO(dateStr), "MMM d, yyyy") } catch { return dateStr }
}

function label(str: string | null | undefined) {
  if (!str) return "—"
  return str.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

export function AppHopeReview({ items, appId }: AppHopeReviewProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [remarkDialog, setRemarkDialog] = useState<{ open: boolean; itemId: string | null; batch: boolean }>({
    open: false, itemId: null, batch: false,
  })
  const [remarks, setRemarks] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [previewItem, setPreviewItem] = useState<AppItemWithOffice | null>(null)

  const reviewableItems = items.filter(i => i.hope_review_status === "pending" || i.hope_review_status === "remarked")

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === reviewableItems.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(reviewableItems.map(i => i.id)))
    }
  }

  const handleApprove = (itemId: string) => {
    setError(null)
    startTransition(async () => {
      const result = await hopeReviewAppItem(itemId, { action: "approve" })
      if (result.error) setError(result.error)
      else router.refresh()
    })
  }

  const handleBatchApprove = () => {
    if (selected.size === 0) return
    setError(null)
    startTransition(async () => {
      const result = await hopeBatchReviewAppItems(Array.from(selected), "approve")
      if (result.error) setError(result.error)
      else {
        setSelected(new Set())
        router.refresh()
      }
    })
  }

  const openRemarkDialog = (itemId: string | null, batch: boolean) => {
    setRemarkDialog({ open: true, itemId, batch })
    setRemarks("")
  }

  const handleRemark = () => {
    if (remarks.trim().length < 5) return
    setError(null)
    startTransition(async () => {
      if (remarkDialog.batch) {
        const result = await hopeBatchReviewAppItems(Array.from(selected), "remark", remarks)
        if (result.error) setError(result.error)
        else {
          setSelected(new Set())
          setRemarkDialog({ open: false, itemId: null, batch: false })
          router.refresh()
        }
      } else if (remarkDialog.itemId) {
        const result = await hopeReviewAppItem(remarkDialog.itemId, { action: "remark", remarks })
        if (result.error) setError(result.error)
        else {
          setRemarkDialog({ open: false, itemId: null, batch: false })
          router.refresh()
        }
      }
    })
  }

  if (items.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">No items to review.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Batch actions */}
      {reviewableItems.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {selected.size} of {reviewableItems.length} selected
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleBatchApprove}
            disabled={selected.size === 0 || isPending}
          >
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Approve Selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openRemarkDialog(null, true)}
            disabled={selected.size === 0 || isPending}
          >
            <MessageSquareWarning className="mr-1.5 h-3.5 w-3.5" />
            Remark Selected
          </Button>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                {reviewableItems.length > 0 && (
                  <Checkbox
                    checked={selected.size === reviewableItems.length && reviewableItems.length > 0}
                    onCheckedChange={toggleAll}
                  />
                )}
              </TableHead>
              <TableHead className="w-[50px]">#</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Source Office</TableHead>
              <TableHead className="text-right">Est. Budget</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[200px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const office = item.source_office as { name: string; code: string } | null
              const isReviewable = item.hope_review_status === "pending" || item.hope_review_status === "remarked"
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    {isReviewable && (
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => toggleSelect(item.id)}
                      />
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {item.item_number}
                  </TableCell>
                  <TableCell>
                    <p className="font-medium text-sm">{item.general_description}</p>
                    {item.hope_remarks && (
                      <p className="text-xs text-orange-600 mt-0.5">{item.hope_remarks}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{office?.name ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <AmountDisplay amount={item.estimated_budget} className="text-sm" />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.hope_review_status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => setPreviewItem(item)}
                        title="Preview item details"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {isReviewable ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleApprove(item.id)}
                            disabled={isPending}
                            className="h-7 text-xs"
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openRemarkDialog(item.id, false)}
                            disabled={isPending}
                            className="h-7 text-xs"
                          >
                            Remark
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Reviewed</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Item Preview Modal */}
      <Dialog open={!!previewItem} onOpenChange={(open) => { if (!open) setPreviewItem(null) }}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
          <div className="border-b border-border/60 bg-muted/20 px-6 py-5">
            <DialogHeader className="gap-1.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  Item #{previewItem?.item_number}
                </Badge>
                <StatusBadge status={previewItem?.hope_review_status ?? "pending"} />
              </div>
              <DialogTitle className="text-base font-semibold leading-snug">
                {previewItem?.general_description}
              </DialogTitle>
              {previewItem?.source_office && (
                <DialogDescription className="text-sm">
                  {(previewItem.source_office as { name: string; code: string }).name}
                </DialogDescription>
              )}
            </DialogHeader>
          </div>

          <div className="divide-y divide-border/50 px-6 py-2 max-h-[60vh] overflow-y-auto">
            <DetailRow label="Estimated Budget">
              <AmountDisplay amount={previewItem?.estimated_budget ?? "0"} className="text-sm font-semibold" />
            </DetailRow>
            <DetailRow label="Project Type">
              {label(previewItem?.project_type)}
            </DetailRow>
            <DetailRow label="Procurement Mode">
              {label(previewItem?.procurement_mode)}
            </DetailRow>
            <DetailRow label="Source of Funds">
              {previewItem?.source_of_funds ?? "—"}
            </DetailRow>
            <DetailRow label="Procurement Schedule">
              {previewItem?.procurement_start || previewItem?.procurement_end
                ? `${formatDate(previewItem?.procurement_start ?? null) ?? "—"} → ${formatDate(previewItem?.procurement_end ?? null) ?? "—"}`
                : "—"}
            </DetailRow>
            <DetailRow label="Delivery Period">
              {previewItem?.delivery_period ?? "—"}
            </DetailRow>
            {previewItem?.lot && (
              <DetailRow label="Lot Assignment">
                <span className="font-mono text-xs">
                  Lot {(previewItem.lot as { lot_number: number; lot_name: string }).lot_number}:{" "}
                  {(previewItem.lot as { lot_number: number; lot_name: string }).lot_name}
                </span>
              </DetailRow>
            )}
            {previewItem?.hope_remarks && (
              <DetailRow label="HOPE Remarks">
                <span className="text-orange-600">{previewItem.hope_remarks}</span>
              </DetailRow>
            )}

            {/* Line items from PPMP */}
            {(previewItem?.source_ppmp_lot?.ppmp_lot_items?.length ?? 0) > 0 && (
              <div className="py-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Line Items to Procure</p>
                <div className="overflow-hidden rounded-lg border border-border/50">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40 bg-muted/40">
                        <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-muted-foreground w-6">#</th>
                        <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Description</th>
                        <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Qty</th>
                        <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-muted-foreground">Unit</th>
                        <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Unit Cost</th>
                        <th className="px-2 py-1.5 text-right font-semibold uppercase tracking-wide text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewItem!.source_ppmp_lot!.ppmp_lot_items.map((li) => (
                        <tr key={li.id} className="border-b border-border/30 last:border-0 bg-white dark:bg-card">
                          <td className="px-2 py-1.5 font-mono text-muted-foreground tabular-nums">{li.item_number}</td>
                          <td className="px-2 py-1.5 whitespace-normal">
                            <span>{li.description}</span>
                            {li.specification && <span className="block text-muted-foreground">{li.specification}</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{Number(li.quantity).toLocaleString()}</td>
                          <td className="px-2 py-1.5">{li.unit}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            <AmountDisplay amount={li.estimated_unit_cost} className="text-xs" />
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                            <AmountDisplay amount={li.estimated_total_cost} className="text-xs" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border/60 bg-muted/25 px-6 py-4 flex justify-end gap-2">
            {(previewItem?.hope_review_status === "pending" || previewItem?.hope_review_status === "remarked") && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    openRemarkDialog(previewItem.id, false)
                    setPreviewItem(null)
                  }}
                  disabled={isPending}
                >
                  <MessageSquareWarning className="mr-1.5 h-3.5 w-3.5" />
                  Remark
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    handleApprove(previewItem.id)
                    setPreviewItem(null)
                  }}
                  disabled={isPending}
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Approve
                </Button>
              </>
            )}
            {previewItem?.hope_review_status === "approved" && (
              <Button size="sm" variant="outline" onClick={() => setPreviewItem(null)}>
                Close
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Remark Dialog */}
      <Dialog open={remarkDialog.open} onOpenChange={(open) => {
        if (!open) setRemarkDialog({ open: false, itemId: null, batch: false })
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Remarks</DialogTitle>
            <DialogDescription>
              {remarkDialog.batch
                ? `Add remarks to ${selected.size} selected item(s). These will be returned to the originating office for revision.`
                : "Add remarks to this item. It will be returned to the originating office for revision."
              }
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Enter your remarks (min 5 characters)..."
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemarkDialog({ open: false, itemId: null, batch: false })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRemark}
              disabled={remarks.trim().length < 5 || isPending}
            >
              Submit Remarks
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3">
      <span className="w-40 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  )
}
