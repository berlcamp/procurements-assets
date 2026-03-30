"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { approveJoinRequest, rejectJoinRequest } from "@/lib/actions/join-requests"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { CheckIcon, XIcon, ClockIcon } from "lucide-react"
import type { JoinRequestWithOffice } from "@/lib/actions/join-requests"

function fullName(r: JoinRequestWithOffice): string {
  const parts = [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(" ")
  return r.suffix ? `${parts}, ${r.suffix}` : parts
}

function RequestRow({ request }: { request: JoinRequestWithOffice }) {
  const router = useRouter()
  const [processing, setProcessing] = useState(false)
  const [showRejectNotes, setShowRejectNotes] = useState(false)
  const [rejectNotes, setRejectNotes] = useState("")

  async function handleApprove() {
    setProcessing(true)
    const { error } = await approveJoinRequest(request.id)
    if (error) {
      toast.error(error)
      setProcessing(false)
      return
    }
    toast.success(`${request.first_name} ${request.last_name} has been approved.`)
    router.refresh()
  }

  async function handleReject() {
    if (!showRejectNotes) {
      setShowRejectNotes(true)
      return
    }
    setProcessing(true)
    const { error } = await rejectJoinRequest(request.id, rejectNotes.trim() || undefined)
    if (error) {
      toast.error(error)
      setProcessing(false)
      return
    }
    toast.success(`Request from ${request.first_name} ${request.last_name} has been declined.`)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{fullName(request)}</p>
          <p className="text-xs text-muted-foreground">
            {request.position ?? "No position specified"}
            {request.office && <> &middot; {request.office.name}</>}
            {" "}&middot; Submitted{" "}
            {new Date(request.created_at).toLocaleDateString("en-PH", {
              dateStyle: "medium",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleReject}
            disabled={processing}
          >
            <XIcon className="mr-1 h-3.5 w-3.5" />
            Decline
          </Button>
          <Button size="sm" onClick={handleApprove} disabled={processing}>
            <CheckIcon className="mr-1 h-3.5 w-3.5" />
            Approve
          </Button>
        </div>
      </div>
      {showRejectNotes && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="Reason for declining (optional)"
            value={rejectNotes}
            onChange={(e) => setRejectNotes(e.target.value)}
            className="text-sm"
          />
          <Button
            size="sm"
            variant="destructive"
            onClick={handleReject}
            disabled={processing}
          >
            Confirm
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowRejectNotes(false)}
            disabled={processing}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

export function PendingRequestsCard({
  requests,
}: {
  requests: JoinRequestWithOffice[]
}) {
  if (requests.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ClockIcon className="h-5 w-5 text-amber-500" />
          <CardTitle className="text-lg">Pending Join Requests</CardTitle>
          <Badge variant="secondary">{requests.length}</Badge>
        </div>
        <CardDescription>
          Users requesting to join your division. Review and approve or decline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {requests.map((r) => (
          <RequestRow key={r.id} request={r} />
        ))}
      </CardContent>
    </Card>
  )
}
