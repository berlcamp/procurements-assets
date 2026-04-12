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
import { getSubAros, getActiveFiscalYear } from "@/lib/actions/budget"
import { getUserPermissions } from "@/lib/actions/roles"
import { SUB_ARO_STATUS_LABELS, ALLOTMENT_CLASS_LABELS } from "@/lib/schemas/budget"
import { format } from "date-fns"
import type { SubAroWithDetails } from "@/types/database"

const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  active: "default",
  fully_allocated: "secondary",
  expired: "destructive",
  cancelled: "destructive",
}

export default async function SubArosPage() {
  const [fiscalYear, allSubAros, permissions] = await Promise.all([
    getActiveFiscalYear(),
    getSubAros(),
    getUserPermissions(),
  ])

  const canCreate = permissions.includes("budget.create") || permissions.includes("budget.certify")

  const subAros = fiscalYear
    ? allSubAros.filter(s => {
        const fy = s.fiscal_year as { id: string } | undefined
        return fy?.id === fiscalYear.id
      })
    : allSubAros

  // Summary
  const totalAmount = subAros.reduce((s, a) => s + parseFloat(a.total_amount), 0)
  const totalAllocated = subAros.reduce((s, a) => s + parseFloat(a.allocated_amount), 0)
  const unallocated = totalAmount - totalAllocated

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sub-Allotment Release Orders</h1>
          <p className="text-muted-foreground text-sm">
            {fiscalYear ? `FY ${fiscalYear.year}` : "All fiscal years"} — Track fund authority from Central/Regional
          </p>
        </div>
        {canCreate && (
          <Button nativeButton={false} render={<Link href="/dashboard/budget/sub-aros/new" />}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Sub-ARO
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Total Sub-ARO Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPeso(totalAmount)}</p>
            <p className="text-xs text-muted-foreground mt-1">{subAros.length} Sub-AROs</p>
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
          <CardTitle className="text-base">All Sub-AROs ({subAros.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {subAros.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <p className="text-muted-foreground text-sm">No Sub-AROs recorded yet.</p>
              {canCreate && (
                <Link href="/dashboard/budget/sub-aros/new" className="mt-3 block">
                  <Button variant="outline" size="sm">Record your first Sub-ARO</Button>
                </Link>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sub-ARO #</TableHead>
                  <TableHead>ARO #</TableHead>
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
                {subAros.map(aro => (
                  <TableRow key={aro.id}>
                    <TableCell className="font-mono text-sm font-medium">{aro.sub_aro_number}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {aro.aro_number ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">{aro.fund_source?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {ALLOTMENT_CLASS_LABELS[aro.allotment_class] ?? aro.allotment_class}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={aro.total_amount} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={aro.allocated_amount} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {aro.release_date
                        ? format(new Date(aro.release_date), "MMM d, yyyy")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariants[aro.status] ?? "outline"}>
                        {SUB_ARO_STATUS_LABELS[aro.status] ?? aro.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/budget/sub-aros/${aro.id}`} />}>
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
