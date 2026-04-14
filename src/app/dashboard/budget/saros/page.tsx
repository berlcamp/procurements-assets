import Link from "next/link"
import { Plus } from "lucide-react"
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
import { AmountDisplay, formatPeso } from "@/components/shared/amount-display"
import { getSaros, getActiveFiscalYear } from "@/lib/actions/budget"
import { getUserPermissions } from "@/lib/actions/roles"
import { SARO_STATUS_LABELS, ALLOTMENT_CLASS_LABELS } from "@/lib/schemas/budget"
import { format } from "date-fns"
import type { SaroWithDetails } from "@/types/database"

const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  active: "default",
  fully_allocated: "secondary",
  expired: "destructive",
  cancelled: "destructive",
}

export default async function SarosPage() {
  const [fiscalYear, allSaros, permissions] = await Promise.all([
    getActiveFiscalYear(),
    getSaros(),
    getUserPermissions(),
  ])

  const canCreate = permissions.includes("budget.create") || permissions.includes("budget.certify")

  const saros = fiscalYear
    ? allSaros.filter(s => {
        const fy = s.fiscal_year as { id: string } | undefined
        return fy?.id === fiscalYear.id
      })
    : allSaros

  // Summary
  const totalAmount = saros.reduce((s, a) => s + parseFloat(a.total_amount), 0)
  const totalAllocated = saros.reduce((s, a) => s + parseFloat(a.allocated_amount), 0)
  const unallocated = totalAmount - totalAllocated

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Special Allotment Release Orders</h1>
          <p className="text-muted-foreground text-sm">
            {fiscalYear ? `FY ${fiscalYear.year}` : "All fiscal years"} — Track fund authority from DBM for special-purpose funds
          </p>
        </div>
        {canCreate && (
          <Button nativeButton={false} render={<Link href="/dashboard/budget/saros/new" />}>
            <Plus className="mr-1.5 h-4 w-4" />
            New SARO
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Total SARO Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPeso(totalAmount)}</p>
            <p className="text-xs text-muted-foreground mt-1">{saros.length} SAROs</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Allocated to Offices</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{formatPeso(totalAllocated)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {totalAmount > 0 ? Math.round((totalAllocated / totalAmount) * 100) : 0}% allocated
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Unallocated Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-600">{formatPeso(unallocated)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All SAROs ({saros.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {saros.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <p className="text-muted-foreground text-sm">No SAROs recorded yet.</p>
              {canCreate && (
                <Link href="/dashboard/budget/saros/new" className="mt-3 block">
                  <Button variant="outline" size="sm">Record your first SARO</Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SARO #</TableHead>
                  <TableHead>Ref #</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Fund Source</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                  <TableHead>Released</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {saros.map(saro => (
                  <TableRow key={saro.id}>
                    <TableCell className="font-mono text-sm font-medium">{saro.saro_number}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {saro.reference_number ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{saro.program ?? "—"}</TableCell>
                    <TableCell className="text-sm">{saro.fund_source?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {ALLOTMENT_CLASS_LABELS[saro.allotment_class] ?? saro.allotment_class}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={saro.total_amount} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={saro.allocated_amount} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {saro.release_date
                        ? format(new Date(saro.release_date), "MMM d, yyyy")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariants[saro.status] ?? "outline"}>
                        {SARO_STATUS_LABELS[saro.status] ?? saro.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/budget/saros/${saro.id}`} />}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
