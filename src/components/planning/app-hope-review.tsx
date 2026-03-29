"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { CheckCircle2, MessageSquareWarning } from "lucide-react"
import { hopeReviewAppItem, hopeBatchReviewAppItems } from "@/lib/actions/app"
import { useRouter } from "next/navigation"
import type { AppItemWithOffice } from "@/types/database"

interface AppHopeReviewProps {
  items: AppItemWithOffice[]
  appId: string
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
              <TableHead className="w-[180px]">Actions</TableHead>
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
                    {isReviewable ? (
                      <div className="flex gap-1">
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
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Reviewed</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

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
