import Link from "next/link"
import { getActiveFiscalYear, getBudgetAllocations, getFiscalYears } from "@/lib/actions/budget"
import { getUserPermissions } from "@/lib/actions/roles"
import { Button } from "@/components/ui/button"
import { AmountDisplay } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import { FundAvailabilityBadge } from "@/components/budget/fund-availability-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PlusIcon } from "lucide-react"
import type { BudgetAllocationWithDetails } from "@/types/database"

export default async function AllocationsPage() {
  const [fiscalYear, allocations, permissions] = await Promise.all([
    getActiveFiscalYear(),
    getBudgetAllocations(),
    getUserPermissions(),
  ])

  const canCreate = permissions.includes("budget.create")

  const activeAllocations = fiscalYear
    ? allocations.filter((a) => {
        const fy = a.fiscal_year as { id: string } | undefined
        return fy?.id === fiscalYear.id
      })
    : allocations

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Budget Allocations</h1>
          <p className="text-muted-foreground text-sm">
            {fiscalYear
              ? `Showing FY ${fiscalYear.year} allocations`
              : "Showing all allocations"}
          </p>
        </div>
        {canCreate && (
          <Link href="/dashboard/budget/allocations/new">
            <Button>
              <PlusIcon className="mr-1.5 h-4 w-4" />
              New Allocation
            </Button>
          </Link>
        )}
      </div>

      {activeAllocations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm">No allocations yet.</p>
          {canCreate && (
            <Link href="/dashboard/budget/allocations/new" className="mt-3 block">
              <Button variant="outline" size="sm">
                Create your first allocation
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Office</TableHead>
                <TableHead>Fund Source</TableHead>
                <TableHead>Account Code</TableHead>
                <TableHead className="text-right">Adjusted</TableHead>
                <TableHead className="text-right">Obligated</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeAllocations.map((a: BudgetAllocationWithDetails) => {
                const office = a.office as { name: string; code: string } | undefined
                const fs = a.fund_source as { name: string } | undefined
                const ac = a.account_code as { code: string; name: string; expense_class: string } | undefined
                const available = parseFloat(a.adjusted_amount) - parseFloat(a.obligated_amount)

                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{office?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fs?.name ?? "—"}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{ac?.code}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">{ac?.expense_class}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={a.adjusted_amount} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={a.obligated_amount} />
                    </TableCell>
                    <TableCell>
                      <FundAvailabilityBadge
                        availableAmount={available}
                        adjustedAmount={a.adjusted_amount}
                      />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                    </TableCell>
                    <TableCell>
                      <Link href={`/dashboard/budget/allocations/${a.id}`}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
