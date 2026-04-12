import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay, formatPeso } from "@/components/shared/amount-display"
import { getObligationRequests, getObligationSummary } from "@/lib/actions/budget"
import { OBR_STATUS_LABELS } from "@/lib/schemas/procurement"
import { format } from "date-fns"
import { FileText, Gavel } from "lucide-react"
import type { ObligationRequestWithDetails } from "@/types/database"

const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  certified: "secondary",
  obligated: "default",
  cancelled: "destructive",
}

function ObrTable({ obrs }: { obrs: ObligationRequestWithDetails[] }) {
  if (obrs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No obligation requests found.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>OBR Number</TableHead>
          <TableHead>PR Number</TableHead>
          <TableHead>Office</TableHead>
          <TableHead>Fund Source</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Certified</TableHead>
          <TableHead>Obligated</TableHead>
          <TableHead className="w-[80px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {obrs.map(obr => {
          const pr = obr.purchase_request
          const fs = obr.budget_allocation?.fund_source

          return (
            <TableRow key={obr.id}>
              <TableCell className="font-mono text-sm font-medium">{obr.obr_number}</TableCell>
              <TableCell>
                {pr ? (
                  <Link
                    href={`/dashboard/procurement/purchase-requests/${pr.id}`}
                    className="text-sm text-blue-600 hover:underline font-mono"
                  >
                    {pr.pr_number}
                  </Link>
                ) : "—"}
              </TableCell>
              <TableCell className="text-sm">{obr.office?.name ?? pr?.office?.name ?? "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{fs?.name ?? "—"}</TableCell>
              <TableCell className="text-right">
                <AmountDisplay amount={obr.amount} />
              </TableCell>
              <TableCell>
                <Badge variant={statusVariants[obr.status] ?? "outline"}>
                  {OBR_STATUS_LABELS[obr.status] ?? obr.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {obr.certified_at
                  ? format(new Date(obr.certified_at), "MMM d, yyyy")
                  : "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {obr.obligated_at
                  ? format(new Date(obr.obligated_at), "MMM d, yyyy")
                  : "—"}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {pr && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      nativeButton={false}
                      render={<Link href={`/dashboard/procurement/purchase-requests/${pr.id}`} />}
                      title="View PR"
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {obr.procurement && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      nativeButton={false}
                      render={<Link href={`/dashboard/procurement/activities/${obr.procurement.id}`} />}
                      title="View Procurement"
                    >
                      <Gavel className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export default async function ObligationsPage() {
  const [obrs, summary] = await Promise.all([
    getObligationRequests(),
    getObligationSummary(),
  ])

  const certifiedObrs = obrs.filter(o => o.status === "certified")
  const obligatedObrs = obrs.filter(o => o.status === "obligated")
  const cancelledObrs = obrs.filter(o => o.status === "cancelled")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Obligations (OBR)</h1>
        <p className="text-muted-foreground text-sm">
          Track obligation requests across the procurement lifecycle
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Total OBRs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.total_count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Certified</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600">{summary.certified_count}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatPeso(summary.total_certified_amount)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Obligated</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{summary.obligated_count}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {formatPeso(summary.total_obligated_amount)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Cancelled</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{summary.cancelled_count}</p>
          </CardContent>
        </Card>
      </div>

      {/* Certified OBRs — awaiting PO approval */}
      {certifiedObrs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Certified — Awaiting Obligation ({certifiedObrs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ObrTable obrs={certifiedObrs} />
          </CardContent>
        </Card>
      )}

      {/* Obligated OBRs */}
      {obligatedObrs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Obligated ({obligatedObrs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ObrTable obrs={obligatedObrs} />
          </CardContent>
        </Card>
      )}

      {/* All OBRs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Obligation Requests ({obrs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ObrTable obrs={obrs} />
        </CardContent>
      </Card>

      {/* Cancelled — collapsed */}
      {cancelledObrs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">
              Cancelled ({cancelledObrs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ObrTable obrs={cancelledObrs} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
