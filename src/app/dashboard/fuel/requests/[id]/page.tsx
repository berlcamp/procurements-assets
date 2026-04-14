"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { useAuth } from "@/lib/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
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
import {
  ArrowLeft,
  Loader2,
  CheckCircle,
  XCircle,
  Printer,
  FileText,
  Ban,
  Package,
} from "lucide-react"
import {
  getFuelRequestById,
  approveFuelRequest,
  rejectFuelRequest,
  cancelFuelRequest,
  dispenseFuelRequest,
} from "@/lib/actions/fuel"
import {
  FUEL_STATUS_LABELS,
  FUEL_STATUS_COLORS,
} from "@/lib/schemas/fuel"
import type { FuelRequestWithDetails } from "@/types/database"

export default function FuelRequestDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { can, loading: permsLoading } = usePermissions()

  const [request, setRequest] = useState<FuelRequestWithDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  // Approve dialog state
  const [approveOpen, setApproveOpen] = useState(false)
  const [approveRemarks, setApproveRemarks] = useState("")
  const [litersApproved, setLitersApproved] = useState("")

  // Reject dialog state
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState("")

  const id = params.id as string

  const loadRequest = useCallback(async () => {
    const data = await getFuelRequestById(id)
    setRequest(data)
    setLoading(false)
  }, [id])

  useEffect(() => {
    loadRequest()
  }, [loadRequest])

  if (authLoading || permsLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!request) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Fuel request not found.</p>
        <Button variant="ghost" className="mt-4" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Go Back
        </Button>
      </div>
    )
  }

  const isOwner = user?.id === request.requested_by
  const canApprove = can("fuel.approve")
  const canManage = can("fuel.manage_inventory")
  const isPending = request.status === "pending"
  const isApproved = request.status === "approved"

  async function handleApprove() {
    setActionLoading(true)
    const result = await approveFuelRequest({
      request_id: id,
      liters_approved: litersApproved ? parseFloat(litersApproved) : undefined,
      remarks: approveRemarks || null,
    })

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Fuel request approved")
      setApproveOpen(false)
      await loadRequest()
    }
    setActionLoading(false)
  }

  async function handleReject() {
    if (rejectReason.length < 5) {
      toast.error("Rejection reason must be at least 5 characters")
      return
    }
    setActionLoading(true)
    const result = await rejectFuelRequest({
      request_id: id,
      reason: rejectReason,
    })

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Fuel request rejected")
      setRejectOpen(false)
      await loadRequest()
    }
    setActionLoading(false)
  }

  async function handleCancel() {
    setActionLoading(true)
    const result = await cancelFuelRequest(id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Fuel request cancelled")
      await loadRequest()
    }
    setActionLoading(false)
  }

  async function handleDispense() {
    setActionLoading(true)
    const result = await dispenseFuelRequest(id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Fuel marked as dispensed")
      await loadRequest()
    }
    setActionLoading(false)
  }

  const passengers = (request.passengers ?? []) as Array<{
    name: string
    position: string
  }>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">
              Trip Ticket: {request.request_number}
            </h1>
            <p className="text-sm text-muted-foreground">
              Submitted on {new Date(request.created_at).toLocaleDateString()}
            </p>
          </div>
          <Badge variant={FUEL_STATUS_COLORS[request.status] ?? "outline"}>
            {FUEL_STATUS_LABELS[request.status] ?? request.status}
          </Badge>
        </div>

        <div className="flex gap-2">
          {/* Print buttons */}
          {(isApproved || request.status === "dispensed") && (
            <>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    href={`/api/documents/fuel-voucher/${id}`}
                    target="_blank"
                  />
                }
              >
                <FileText className="h-4 w-4 mr-1" />
                Voucher Slip
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link
                href={`/api/documents/fuel-trip-ticket/${id}`}
                target="_blank"
              />
            }
          >
            <Printer className="h-4 w-4 mr-1" />
            Trip Ticket
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Trip Information */}
          <Card>
            <CardHeader>
              <CardTitle>Trip Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-muted-foreground text-xs">Date of Trip</Label>
                <p className="font-medium">{new Date(request.date_of_trip).toLocaleDateString()}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Office</Label>
                <p className="font-medium">{request.office?.name ?? "—"}</p>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-muted-foreground text-xs">Destination</Label>
                <p className="font-medium">{request.destination}</p>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-muted-foreground text-xs">Purpose</Label>
                <p className="font-medium">{request.purpose}</p>
              </div>
            </CardContent>
          </Card>

          {/* Vehicle Details */}
          <Card>
            <CardHeader>
              <CardTitle>Vehicle Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label className="text-muted-foreground text-xs">Vehicle Type</Label>
                <p className="font-medium">{request.vehicle_type}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Plate Number</Label>
                <p className="font-medium">{request.vehicle_plate_number}</p>
              </div>
              {request.km_departure && (
                <div>
                  <Label className="text-muted-foreground text-xs">Odometer (km)</Label>
                  <p className="font-medium">{parseFloat(request.km_departure).toLocaleString()}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Passengers */}
          {passengers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Passengers</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Position</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {passengers.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>{p.position}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Fuel Details */}
          <Card>
            <CardHeader>
              <CardTitle>Fuel Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-muted-foreground text-xs">Fuel Type</Label>
                <p className="font-medium">{request.fuel_type?.name ?? "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Liters Requested</Label>
                <p className="text-xl font-bold">{parseFloat(request.liters_requested).toLocaleString()} L</p>
              </div>
              {request.liters_approved && (
                <div>
                  <Label className="text-muted-foreground text-xs">Liters Approved</Label>
                  <p className="text-xl font-bold text-green-600">
                    {parseFloat(request.liters_approved).toLocaleString()} L
                  </p>
                </div>
              )}
              {request.fuel_type?.price_per_unit && request.liters_approved && (
                <div>
                  <Label className="text-muted-foreground text-xs">Estimated Cost</Label>
                  <p className="font-medium">
                    PHP {(
                      parseFloat(request.liters_approved) *
                      parseFloat(request.fuel_type.price_per_unit)
                    ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Requester Info */}
          <Card>
            <CardHeader>
              <CardTitle>Requester</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-muted-foreground text-xs">Name</Label>
                <p className="font-medium">
                  {request.requested_by_profile
                    ? `${request.requested_by_profile.first_name} ${request.requested_by_profile.last_name}`
                    : "—"}
                </p>
              </div>
              {request.requested_by_profile?.position && (
                <div>
                  <Label className="text-muted-foreground text-xs">Position</Label>
                  <p className="font-medium">{request.requested_by_profile.position}</p>
                </div>
              )}
              {request.approved_by_profile && (
                <div>
                  <Label className="text-muted-foreground text-xs">
                    {request.status === "rejected" ? "Rejected By" : "Approved By"}
                  </Label>
                  <p className="font-medium">
                    {request.approved_by_profile.first_name} {request.approved_by_profile.last_name}
                  </p>
                </div>
              )}
              {request.approver_remarks && (
                <div>
                  <Label className="text-muted-foreground text-xs">Remarks</Label>
                  <p className="text-sm">{request.approver_remarks}</p>
                </div>
              )}
              {request.rejection_reason && (
                <div>
                  <Label className="text-muted-foreground text-xs">Rejection Reason</Label>
                  <p className="text-sm text-destructive">{request.rejection_reason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Approve button */}
              {canApprove && isPending && (
                <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
                  <DialogTrigger render={<Button className="w-full" variant="default" />}>
                    <CheckCircle className="h-4 w-4 mr-1.5" />
                    Approve Request
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-green-600" />
                        Approve Fuel Request
                      </DialogTitle>
                      <DialogDescription>
                        Review and approve this fuel request. Fuel will be deducted from inventory upon approval.
                      </DialogDescription>
                    </DialogHeader>

                    {/* Request summary */}
                    <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Request</span>
                        <span className="font-medium">{request.request_number}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Fuel Type</span>
                        <span className="font-medium">{request.fuel_type?.name ?? "—"}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Liters Requested</span>
                        <span className="font-bold text-base">{parseFloat(request.liters_requested).toLocaleString()} L</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Destination</span>
                        <span className="font-medium">{request.destination}</span>
                      </div>
                    </div>

                    <div className="space-y-3 py-1">
                      <div className="space-y-1.5">
                        <Label htmlFor="liters-approved">Liters to Approve</Label>
                        <Input
                          id="liters-approved"
                          type="number"
                          step="0.01"
                          value={litersApproved}
                          onChange={e => setLitersApproved(e.target.value)}
                          placeholder={parseFloat(request.liters_requested).toLocaleString()}
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave blank to approve the full requested amount ({parseFloat(request.liters_requested).toLocaleString()} L)
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="approve-remarks">Remarks</Label>
                        <Textarea
                          id="approve-remarks"
                          value={approveRemarks}
                          onChange={e => setApproveRemarks(e.target.value)}
                          placeholder="Add any notes for the requester (optional)"
                          rows={2}
                        />
                      </div>
                    </div>

                    <DialogFooter>
                      <Button variant="outline" onClick={() => setApproveOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleApprove} disabled={actionLoading}>
                        {actionLoading ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <CheckCircle className="h-4 w-4 mr-1.5" />
                        )}
                        Confirm Approval
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {/* Reject button */}
              {canApprove && isPending && (
                <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
                  <DialogTrigger render={<Button className="w-full" variant="destructive" />}>
                    <XCircle className="h-4 w-4 mr-1.5" />
                    Reject Request
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <XCircle className="h-5 w-5 text-destructive" />
                        Reject Fuel Request
                      </DialogTitle>
                      <DialogDescription>
                        This will notify the requester that their trip ticket has been rejected.
                        A clear reason helps them understand and resubmit if needed.
                      </DialogDescription>
                    </DialogHeader>

                    {/* Request summary */}
                    <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Request</span>
                        <span className="font-medium">{request.request_number}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Requester</span>
                        <span className="font-medium">
                          {request.requested_by_profile
                            ? `${request.requested_by_profile.first_name} ${request.requested_by_profile.last_name}`
                            : "—"}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Liters Requested</span>
                        <span className="font-medium">{parseFloat(request.liters_requested).toLocaleString()} L</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 py-1">
                      <Label htmlFor="reject-reason">Reason for Rejection *</Label>
                      <Textarea
                        id="reject-reason"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="e.g., Insufficient justification, duplicate request, budget constraints..."
                        rows={3}
                      />
                      {rejectReason.length > 0 && rejectReason.length < 5 && (
                        <p className="text-xs text-destructive">
                          Reason must be at least 5 characters
                        </p>
                      )}
                    </div>

                    <DialogFooter>
                      <Button variant="outline" onClick={() => setRejectOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleReject}
                        disabled={actionLoading || rejectReason.length < 5}
                      >
                        {actionLoading ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <XCircle className="h-4 w-4 mr-1.5" />
                        )}
                        Confirm Rejection
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {/* Dispense button */}
              {canManage && isApproved && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleDispense}
                  disabled={actionLoading}
                >
                  {actionLoading ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Package className="h-4 w-4 mr-1.5" />
                  )}
                  Mark as Dispensed
                </Button>
              )}

              {/* Cancel button */}
              {isOwner && isPending && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleCancel}
                  disabled={actionLoading}
                >
                  {actionLoading ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Ban className="h-4 w-4 mr-1" />
                  )}
                  Cancel Request
                </Button>
              )}

              {request.status !== "pending" && !isApproved && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  No actions available for this status.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
