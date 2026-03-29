"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  suspendDivision,
  reactivateDivision,
  softDeleteDivision,
} from "@/lib/actions/divisions"
import type { Division } from "@/types/database"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

interface DivisionActionsProps {
  division: Division
}

export function DivisionActions({ division }: DivisionActionsProps) {
  const router = useRouter()
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(false)

  const isSuspended = division.subscription_status === "suspended"

  async function handleSuspend() {
    setLoading(true)
    const { error } = await suspendDivision(division.id, reason || undefined)
    setLoading(false)
    if (error) {
      toast.error("Failed to suspend division", { description: error })
    } else {
      toast.success("Division suspended")
      setSuspendDialogOpen(false)
      router.refresh()
    }
  }

  async function handleReactivate() {
    setLoading(true)
    const { error } = await reactivateDivision(division.id)
    setLoading(false)
    if (error) {
      toast.error("Failed to reactivate division", { description: error })
    } else {
      toast.success("Division reactivated")
      router.refresh()
    }
  }

  async function handleDelete() {
    setLoading(true)
    const { error } = await softDeleteDivision(division.id)
    setLoading(false)
    if (error) {
      toast.error("Failed to delete division", { description: error })
    } else {
      toast.success("Division deleted")
      setDeleteDialogOpen(false)
      router.push("/platform/divisions")
    }
  }

  return (
    <>
      {isSuspended ? (
        <Button onClick={handleReactivate} disabled={loading} variant="outline">
          Reactivate
        </Button>
      ) : (
        <Button
          onClick={() => setSuspendDialogOpen(true)}
          disabled={loading}
          variant="outline"
          className="text-orange-600 hover:text-orange-700"
        >
          Suspend
        </Button>
      )}

      <Button
        onClick={() => setDeleteDialogOpen(true)}
        disabled={loading}
        variant="outline"
        className="text-red-600 hover:text-red-700"
      >
        Delete
      </Button>

      {/* Suspend Dialog */}
      <Dialog
        open={suspendDialogOpen}
        onOpenChange={(open) => setSuspendDialogOpen(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend Division</DialogTitle>
            <DialogDescription>
              This will suspend access for {division.name}. You can reactivate
              it later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Provide a reason for suspension..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSuspendDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSuspend}
              disabled={loading}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {loading ? "Suspending..." : "Suspend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => setDeleteDialogOpen(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Division</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {division.name}? This action
              cannot be undone (soft delete).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
