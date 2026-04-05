import Link from "next/link"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { getMyPrs, getPrsRequiringMyAction } from "@/lib/actions/procurement"
import { format } from "date-fns"
import type { PurchaseRequestWithDetails } from "@/types/database"

function PrTable({ prs }: { prs: PurchaseRequestWithDetails[] }) {
  if (prs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No Purchase Requests found.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>PR Number</TableHead>
          <TableHead>Office</TableHead>
          <TableHead>APP Item</TableHead>
          <TableHead className="text-right">Total Cost</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Date</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {prs.map(pr => (
          <TableRow key={pr.id}>
            <TableCell className="font-mono text-sm">{pr.pr_number}</TableCell>
            <TableCell className="text-sm">{pr.office?.name ?? "—"}</TableCell>
            <TableCell className="text-sm max-w-xs truncate">
              {pr.app_item?.general_description
                ? pr.app_item.general_description.slice(0, 50) +
                  (pr.app_item.general_description.length > 50 ? "…" : "")
                : "—"}
            </TableCell>
            <TableCell className="text-right">
              <AmountDisplay amount={pr.total_estimated_cost} />
            </TableCell>
            <TableCell>
              <StatusBadge status={pr.status} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {format(new Date(pr.created_at), "MMM d, yyyy")}
            </TableCell>
            <TableCell>
              <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/procurement/purchase-requests/${pr.id}`} />}>
                View
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default async function PurchaseRequestsPage() {
  const [myPrs, actionPrs] = await Promise.all([
    getMyPrs(),
    getPrsRequiringMyAction(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Purchase Requests</h1>
          <p className="text-sm text-muted-foreground">Manage and track your Purchase Requests</p>
        </div>
        <Button nativeButton={false} render={<Link href="/dashboard/procurement/purchase-requests/new" />}>
          <Plus className="mr-1.5 h-4 w-4" />
          New PR
        </Button>
      </div>

      {actionPrs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Requires My Action</CardTitle>
            <CardDescription>
              Purchase Requests awaiting your certification or approval
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PrTable prs={actionPrs} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Purchase Requests</CardTitle>
          <CardDescription>Purchase Requests you have created</CardDescription>
        </CardHeader>
        <CardContent>
          {myPrs.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-sm text-muted-foreground">You haven&apos;t created any Purchase Requests yet.</p>
              <Button nativeButton={false} render={<Link href="/dashboard/procurement/purchase-requests/new" />}>
                Create your first PR
              </Button>
            </div>
          ) : (
            <PrTable prs={myPrs} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
