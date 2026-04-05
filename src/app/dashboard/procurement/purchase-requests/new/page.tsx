import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getActiveFiscalYear } from "@/lib/actions/budget"
import { getOfficesForUser } from "@/lib/actions/procurement"
import { PrCreateForm } from "@/components/procurement/pr-create-form"

export default async function NewPurchaseRequestPage() {
  const [fiscalYear, offices] = await Promise.all([
    getActiveFiscalYear(),
    getOfficesForUser(),
  ])

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
