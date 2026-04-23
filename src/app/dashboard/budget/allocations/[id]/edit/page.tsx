import Link from "next/link"
import { notFound } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AllocationForm } from "@/components/budget/allocation-form"
import { Forbidden } from "@/components/shared/forbidden"
import { getBudgetAllocationById } from "@/lib/actions/budget"
import { getUserPermissions } from "@/lib/actions/roles"

export default async function EditAllocationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [allocation, permissions] = await Promise.all([
    getBudgetAllocationById(id),
    getUserPermissions(),
  ])

  if (!allocation) notFound()

  if (!permissions.includes("budget.create")) {
    return (
      <Forbidden
        message="You don't have permission to edit budget allocations. Only roles with budget.create (e.g., Budget Officer, Division Admin) can access this page."
        backHref={`/dashboard/budget/allocations/${id}`}
        backLabel="Back to allocation"
      />
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Edit Budget Allocation</h1>
          <p className="text-muted-foreground text-sm">
            Update the details of this budget allocation. Adjusted, obligated, and disbursed
            balances are managed through the adjustments and obligations workflows.
          </p>
        </div>
        <Link href={`/dashboard/budget/allocations/${id}`}>
          <Button variant="outline" size="sm">Back</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Allocation Details</CardTitle>
          <CardDescription>
            Changing the original amount only re-syncs the adjusted amount if the allocation
            has not yet been used (no obligations, disbursements, or approved adjustments).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AllocationForm allocation={allocation} />
        </CardContent>
      </Card>
    </div>
  )
}
