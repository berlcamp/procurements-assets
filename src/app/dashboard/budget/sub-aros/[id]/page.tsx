import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AmountDisplay, formatPeso } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import { getSubAroById } from "@/lib/actions/budget"
import { getUserPermissions } from "@/lib/actions/roles"
import { SUB_ARO_STATUS_LABELS, ALLOTMENT_CLASS_LABELS } from "@/lib/schemas/budget"
import { format } from "date-fns"
import type { BudgetAllocationWithDetails } from "@/types/database"
import { DeleteSubAroButton } from "./delete-sub-aro-button"

const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  active: "default",
  fully_allocated: "secondary",
  expired: "destructive",
  cancelled: "destructive",
}

export default async function SubAroDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [aro, permissions] = await Promise.all([
    getSubAroById(id),
    getUserPermissions(),
  ])

  if (!aro) notFound()

  const canDelete =
    permissions.includes("budget.create") || permissions.includes("budget.certify")

  const totalAmount = parseFloat(aro.total_amount)
  const allocatedAmount = parseFloat(aro.allocated_amount)
  const unallocated = totalAmount - allocatedAmount
  const utilizationPct = totalAmount > 0 ? Math.round((allocatedAmount / totalAmount) * 100) : 0

  const allocations = (aro.allocations ?? []) as BudgetAllocationWithDetails[]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/dashboard/budget/sub-aros" />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight font-mono">{aro.sub_aro_number}</h1>
            <Badge variant={statusVariants[aro.status] ?? "outline"}>
              {SUB_ARO_STATUS_LABELS[aro.status] ?? aro.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {aro.fund_source?.name ?? "—"} &middot; {ALLOTMENT_CLASS_LABELS[aro.allotment_class]} Appropriation
          </p>
        </div>
        {canDelete && (
          <DeleteSubAroButton id={aro.id} subAroNumber={aro.sub_aro_number} />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sub-ARO Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Sub-ARO Number</dt>
                  <dd className="font-medium font-mono">{aro.sub_aro_number}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Parent ARO</dt>
                  <dd className="font-mono">{aro.aro_number ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Fiscal Year</dt>
                  <dd>{aro.fiscal_year?.year ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Fund Source</dt>
                  <dd>{aro.fund_source?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Allotment Class</dt>
                  <dd>
                    <Badge variant="outline">
                      {ALLOTMENT_CLASS_LABELS[aro.allotment_class]}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Releasing Office</dt>
                  <dd>{aro.releasing_office ?? "—"}</dd>
                </div>
                {aro.release_date && (
                  <div>
                    <dt className="text-muted-foreground">Release Date</dt>
                    <dd>{format(new Date(aro.release_date), "MMMM d, yyyy")}</dd>
                  </div>
                )}
                {aro.validity_date && (
                  <div>
                    <dt className="text-muted-foreground">Validity Date</dt>
                    <dd>{format(new Date(aro.validity_date), "MMMM d, yyyy")}</dd>
                  </div>
                )}
                {aro.purpose && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Purpose</dt>
                    <dd>{aro.purpose}</dd>
                  </div>
                )}
                {aro.remarks && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Remarks</dt>
                    <dd>{aro.remarks}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Linked Allocations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Linked Budget Allocations ({allocations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {allocations.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No allocations linked to this Sub-ARO yet. Create allocations and select this Sub-ARO as the funding authority.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Office</TableHead>
                      <TableHead>Account Code</TableHead>
                      <TableHead className="text-right">Original</TableHead>
                      <TableHead className="text-right">Adjusted</TableHead>
                      <TableHead className="text-right">Obligated</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[60px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocations.map(alloc => {
                      const office = alloc.office as { name: string; code: string } | undefined
                      const ac = alloc.account_code as { code: string; name: string; expense_class: string } | undefined
                      return (
                        <TableRow key={alloc.id}>
                          <TableCell className="font-medium">{office?.name ?? "—"}</TableCell>
                          <TableCell>
                            <span className="font-mono text-xs">{ac?.code}</span>
                            <span className="ml-1.5 text-xs text-muted-foreground">{ac?.expense_class}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <AmountDisplay amount={alloc.original_amount} />
                          </TableCell>
                          <TableCell className="text-right">
                            <AmountDisplay amount={alloc.adjusted_amount} />
                          </TableCell>
                          <TableCell className="text-right">
                            <AmountDisplay amount={alloc.obligated_amount} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={alloc.status} />
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/budget/allocations/${alloc.id}`} />}>
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    <TableRow className="font-semibold">
                      <TableCell colSpan={2} className="text-right">Total</TableCell>
                      <TableCell className="text-right">
                        {formatPeso(allocations.reduce((s, a) => s + parseFloat(a.original_amount), 0))}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPeso(allocations.reduce((s, a) => s + parseFloat(a.adjusted_amount), 0))}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPeso(allocations.reduce((s, a) => s + parseFloat(a.obligated_amount), 0))}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Allocation Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Amount</span>
                  <span className="font-semibold">{formatPeso(totalAmount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Allocated</span>
                  <span className="text-green-600 font-medium">{formatPeso(allocatedAmount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Unallocated</span>
                  <span className="text-amber-600 font-medium">{formatPeso(unallocated)}</span>
                </div>
              </div>

              {/* Utilization bar */}
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Utilization</span>
                  <span>{utilizationPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all"
                    style={{ width: `${Math.min(utilizationPct, 100)}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {aro.release_date && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Released</span>
                  <span>{format(new Date(aro.release_date), "MMM d, yyyy")}</span>
                </div>
              )}
              {aro.validity_date && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valid Until</span>
                  <span>{format(new Date(aro.validity_date), "MMM d, yyyy")}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recorded</span>
                <span>{format(new Date(aro.created_at), "MMM d, yyyy")}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
