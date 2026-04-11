import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getActiveFiscalYear } from "@/lib/actions/budget"
import { getOfficesForUser } from "@/lib/actions/procurement"
import { getUserPermissions } from "@/lib/actions/roles"
import { PrCreateForm } from "@/components/procurement/pr-create-form"
import { Forbidden } from "@/components/shared/forbidden"

export default async function NewPurchaseRequestPage() {
  const [fiscalYear, offices, permissions] = await Promise.all([
    getActiveFiscalYear(),
    getOfficesForUser(),
    getUserPermissions(),
  ])

  if (!permissions.includes("pr.create")) {
    return (
      <Forbidden
        message="You don't have permission to create Purchase Requests. Only roles with pr.create (e.g., End User, School Head, Supply Officer) can access this page."
        backHref="/dashboard/procurement/purchase-requests"
        backLabel="Back to Purchase Requests"
      />
    )
  }

  if (!fiscalYear) {
    redirect("/dashboard/procurement")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard/procurement/purchase-requests" />}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-xl font-bold">New Purchase Request</h1>
          <p className="text-sm text-muted-foreground">FY {fiscalYear.year}</p>
        </div>
      </div>

      <PrCreateForm fiscalYear={fiscalYear} offices={offices} />
    </div>
  )
}
