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
  getMyRequests,
  getPendingApprovals,
  getRequestsForProcessing,
  getAllRequests,
} from "@/lib/actions/requests"
import {
  REQUEST_TYPE_LABELS,
  REQUEST_STATUS_LABELS,
  URGENCY_LABELS,
} from "@/lib/schemas/request"
import type { RequestWithDetails } from "@/types/database"

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "fulfilled": return "default"
    case "rejected": case "cancelled": return "destructive"
    case "submitted": case "supervisor_approved": return "secondary"
    default: return "outline"
  }
}

function urgencyVariant(urgency: string): "default" | "secondary" | "destructive" | "outline" {
  switch (urgency) {
    case "emergency": return "destructive"
    case "high": return "secondary"
    default: return "outline"
  }
}

function RequestTable({ requests, onRowClick }: { requests: RequestWithDetails[], onRowClick: (r: RequestWithDetails) => void }) {
  if (requests.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No requests found.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Request #</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Office</TableHead>
          <TableHead>Purpose</TableHead>
          <TableHead>Urgency</TableHead>
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
            <TableCell>{REQUEST_TYPE_LABELS[req.request_type] ?? req.request_type}</TableCell>
            <TableCell>{req.office?.name ?? "—"}</TableCell>
            <TableCell className="max-w-[200px] truncate">{req.purpose}</TableCell>
            <TableCell>
              <Badge variant={urgencyVariant(req.urgency)}>
                {URGENCY_LABELS[req.urgency] ?? req.urgency}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(req.status)}>
                {REQUEST_STATUS_LABELS[req.status] ?? req.status}
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

export default function RequestsListPage() {
  const { canAny, can, loading: permsLoading } = usePermissions()
  const router = useRouter()

  const [myRequests, setMyRequests] = useState<RequestWithDetails[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<RequestWithDetails[]>([])
  const [processingRequests, setProcessingRequests] = useState<RequestWithDetails[]>([])
  const [allRequests, setAllRequests] = useState<RequestWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [typeFilter, setTypeFilter] = useState<string>("all")

  const canCreate = can("request.create")
  const canApprove = can("request.approve")
  const canProcess = can("request.process")

  const loadData = useCallback(async () => {
    setLoading(true)
    const promises: Promise<RequestWithDetails[]>[] = [getMyRequests()]
    if (canApprove) promises.push(getPendingApprovals())
    if (canProcess) promises.push(getRequestsForProcessing(), getAllRequests())

    const results = await Promise.all(promises)
    let idx = 0
    setMyRequests(results[idx++] ?? [])
    if (canApprove) setPendingApprovals(results[idx++] ?? [])
    if (canProcess) {
      setProcessingRequests(results[idx++] ?? [])
      setAllRequests(results[idx++] ?? [])
    }
    setLoading(false)
  }, [canApprove, canProcess])

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

  if (!canAny("request.create", "request.approve", "request.process")) {
    return <Forbidden message="You do not have permission to access requests." />
  }

  function filterRequests(list: RequestWithDetails[]) {
    return list.filter(req => {
      if (statusFilter !== "all" && req.status !== statusFilter) return false
      if (typeFilter !== "all" && req.request_type !== typeFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          req.request_number.toLowerCase().includes(q) ||
          req.purpose.toLowerCase().includes(q) ||
          (req.requested_by_profile?.first_name?.toLowerCase().includes(q) ?? false) ||
          (req.requested_by_profile?.last_name?.toLowerCase().includes(q) ?? false)
        )
      }
      return true
    })
  }

  function handleRowClick(req: RequestWithDetails) {
    router.push(`/dashboard/requests/${req.id}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Requests</h1>
          <p className="text-sm text-muted-foreground">
            Supply, equipment, service, and procurement requests
          </p>
        </div>
        {canCreate && (
          <Button nativeButton={false} render={<Link href="/dashboard/requests/new" />}>
            <Plus className="h-4 w-4 mr-1" />
            New Request
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
            {Object.entries(REQUEST_STATUS_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {Object.entries(REQUEST_TYPE_LABELS).map(([key, label]) => (
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
          {canProcess && (
            <>
              <TabsTrigger value="processing">
                For Processing ({processingRequests.length})
              </TabsTrigger>
              <TabsTrigger value="all">
                All Requests ({allRequests.length})
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="my">
          <Card>
            <CardHeader>
              <CardTitle>My Requests</CardTitle>
              <CardDescription>Requests you have created</CardDescription>
            </CardHeader>
            <CardContent>
              <RequestTable requests={filterRequests(myRequests)} onRowClick={handleRowClick} />
            </CardContent>
          </Card>
        </TabsContent>

        {canApprove && (
          <TabsContent value="approvals">
            <Card>
              <CardHeader>
                <CardTitle>Pending Approval</CardTitle>
                <CardDescription>Requests awaiting your approval</CardDescription>
              </CardHeader>
              <CardContent>
                <RequestTable requests={filterRequests(pendingApprovals)} onRowClick={handleRowClick} />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canProcess && (
          <>
            <TabsContent value="processing">
              <Card>
                <CardHeader>
                  <CardTitle>For Processing</CardTitle>
                  <CardDescription>Approved requests ready for stock fulfillment or procurement routing</CardDescription>
                </CardHeader>
                <CardContent>
                  <RequestTable requests={filterRequests(processingRequests)} onRowClick={handleRowClick} />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="all">
              <Card>
                <CardHeader>
                  <CardTitle>All Requests</CardTitle>
                  <CardDescription>Division-wide view of all requests</CardDescription>
                </CardHeader>
                <CardContent>
                  <RequestTable requests={filterRequests(allRequests)} onRowClick={handleRowClick} />
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}
