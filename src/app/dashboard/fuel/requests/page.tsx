"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { Forbidden } from "@/components/shared/forbidden"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Search, Plus, Loader2 } from "lucide-react"
import {
  getMyFuelRequests,
  getPendingFuelApprovals,
  getAllFuelRequests,
} from "@/lib/actions/fuel"
import {
  FUEL_STATUS_LABELS,
  FUEL_STATUS_COLORS,
} from "@/lib/schemas/fuel"
import type { FuelRequestWithDetails } from "@/types/database"

function FuelRequestTable({
  requests,
  onRowClick,
}: {
  requests: FuelRequestWithDetails[]
  onRowClick: (r: FuelRequestWithDetails) => void
}) {
  if (requests.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No fuel requests found.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Request #</TableHead>
          <TableHead>Fuel Type</TableHead>
          <TableHead>Destination</TableHead>
          <TableHead>Vehicle</TableHead>
          <TableHead className="text-right">Liters</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Requester</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map(req => (
          <TableRow
            key={req.id}
            className="cursor-pointer hover:bg-muted/50"
            onClick={() => onRowClick(req)}
          >
            <TableCell className="font-medium">{req.request_number}</TableCell>
            <TableCell>{req.fuel_type?.name ?? "—"}</TableCell>
            <TableCell className="max-w-[200px] truncate">{req.destination}</TableCell>
            <TableCell>{req.vehicle_plate_number}</TableCell>
            <TableCell className="text-right">
              {parseFloat(req.liters_requested).toLocaleString()}
            </TableCell>
            <TableCell>
              <Badge variant={FUEL_STATUS_COLORS[req.status] ?? "outline"}>
                {FUEL_STATUS_LABELS[req.status] ?? req.status}
              </Badge>
            </TableCell>
            <TableCell>
              {req.requested_by_profile
                ? `${req.requested_by_profile.first_name} ${req.requested_by_profile.last_name}`
                : "—"}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {new Date(req.created_at).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default function FuelRequestsListPage() {
  const { canAny, can, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const [myRequests, setMyRequests] = useState<FuelRequestWithDetails[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<FuelRequestWithDetails[]>([])
  const [allRequests, setAllRequests] = useState<FuelRequestWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const canRequest = can("fuel.request")
  const canApprove = can("fuel.approve")
  const canManage = can("fuel.manage_inventory")

  const loadData = useCallback(async () => {
    setLoading(true)
    const promises: Promise<FuelRequestWithDetails[]>[] = [getMyFuelRequests()]
    if (canApprove) promises.push(getPendingFuelApprovals())
    if (canManage || canApprove) promises.push(getAllFuelRequests())

    const results = await Promise.all(promises)
    let idx = 0
    setMyRequests(results[idx++] ?? [])
    if (canApprove) setPendingApprovals(results[idx++] ?? [])
    if (canManage || canApprove) setAllRequests(results[idx++] ?? [])
    setLoading(false)
  }, [canApprove, canManage])

  useEffect(() => {
    if (!permsLoading) loadData()
  }, [permsLoading, loadData])

  if (permsLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!canAny("fuel.request", "fuel.approve", "fuel.manage_inventory")) {
    return <Forbidden message="You do not have permission to access fuel requests." />
  }

  function filterRequests(list: FuelRequestWithDetails[]) {
    return list.filter(req => {
      if (statusFilter !== "all" && req.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          req.request_number.toLowerCase().includes(q) ||
          req.destination.toLowerCase().includes(q) ||
          req.vehicle_plate_number.toLowerCase().includes(q) ||
          (req.requested_by_profile?.first_name?.toLowerCase().includes(q) ?? false) ||
          (req.requested_by_profile?.last_name?.toLowerCase().includes(q) ?? false)
        )
      }
      return true
    })
  }

  function handleRowClick(req: FuelRequestWithDetails) {
    router.push(`/dashboard/fuel/requests/${req.id}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Trip Tickets</h1>
          <p className="text-sm text-muted-foreground">
            Fuel requests and trip ticket management
          </p>
        </div>
        {canRequest && (
          <Button nativeButton={false} render={<Link href="/dashboard/fuel/requests/new" />}>
            <Plus className="h-4 w-4 mr-1" />
            New Trip Ticket
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search requests..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(FUEL_STATUS_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="my">
        <TabsList>
          <TabsTrigger value="my">
            My Requests ({myRequests.length})
          </TabsTrigger>
          {canApprove && (
            <TabsTrigger value="approvals">
              Pending Approval ({pendingApprovals.length})
            </TabsTrigger>
          )}
          {(canManage || canApprove) && (
            <TabsTrigger value="all">
              All Requests ({allRequests.length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="my">
          <Card>
            <CardHeader>
              <CardTitle>My Fuel Requests</CardTitle>
              <CardDescription>Trip tickets you have submitted</CardDescription>
            </CardHeader>
            <CardContent>
              <FuelRequestTable requests={filterRequests(myRequests)} onRowClick={handleRowClick} />
            </CardContent>
          </Card>
        </TabsContent>

        {canApprove && (
          <TabsContent value="approvals">
            <Card>
              <CardHeader>
                <CardTitle>Pending Approval</CardTitle>
                <CardDescription>Fuel requests awaiting your approval</CardDescription>
              </CardHeader>
              <CardContent>
                <FuelRequestTable requests={filterRequests(pendingApprovals)} onRowClick={handleRowClick} />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {(canManage || canApprove) && (
          <TabsContent value="all">
            <Card>
              <CardHeader>
                <CardTitle>All Fuel Requests</CardTitle>
                <CardDescription>Division-wide view of all fuel requests</CardDescription>
              </CardHeader>
              <CardContent>
                <FuelRequestTable requests={filterRequests(allRequests)} onRowClick={handleRowClick} />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
