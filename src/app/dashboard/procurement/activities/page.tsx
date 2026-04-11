import Link from "next/link"
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
import { Button } from "@/components/ui/button"
import {
  getProcurementActivities,
  getProcurementsRequiringMyAction,
} from "@/lib/actions/procurement-activities"
import { getUserPermissions } from "@/lib/actions/roles"
import { PROCUREMENT_METHOD_LABELS } from "@/lib/schemas/procurement"
import { format } from "date-fns"
import type { ProcurementActivityWithDetails } from "@/types/database"
import { CreateProcurementDialog } from "@/components/procurement/create-procurement-dialog"

function ActivityTable({ activities }: { activities: ProcurementActivityWithDetails[] }) {
  if (activities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No procurement activities found.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Procurement #</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>PR #</TableHead>
          <TableHead className="text-right">ABC Amount</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead className="text-right">Contract</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Date</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {activities.map(act => (
          <TableRow key={act.id}>
            <TableCell className="font-mono text-sm">{act.procurement_number}</TableCell>
            <TableCell>
              <StatusBadge status={act.procurement_method} />
            </TableCell>
            <TableCell className="font-mono text-sm">
              {act.purchase_request?.pr_number ?? "—"}
            </TableCell>
            <TableCell className="text-right">
              <AmountDisplay amount={act.abc_amount} />
            </TableCell>
            <TableCell>
              <StatusBadge status={act.current_stage} />
            </TableCell>
            <TableCell className="text-sm">
              {act.supplier?.name ?? "—"}
            </TableCell>
            <TableCell className="text-right">
              {act.contract_amount ? <AmountDisplay amount={act.contract_amount} /> : "—"}
            </TableCell>
            <TableCell>
              <StatusBadge status={act.status} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {format(new Date(act.created_at), "MMM d, yyyy")}
            </TableCell>
            <TableCell>
              <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/procurement/activities/${act.id}`} />}>
                View
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default async function ProcurementActivitiesPage() {
  const [activities, actionActivities, permissions] = await Promise.all([
    getProcurementActivities(),
    getProcurementsRequiringMyAction(),
    getUserPermissions(),
  ])

  const canCreate = permissions.includes("proc.create") || permissions.includes("proc.manage")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Procurement Activities</h1>
          <p className="text-sm text-muted-foreground">
            SVP and Shopping procurement workflows
          </p>
        </div>
        {canCreate && <CreateProcurementDialog />}
      </div>

      {actionActivities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Requires My Action</CardTitle>
            <CardDescription>
              Procurement activities awaiting your action
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityTable activities={actionActivities} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Activities</CardTitle>
          <CardDescription>
            All procurement activities in your division
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityTable activities={activities} />
        </CardContent>
      </Card>
    </div>
  )
}
