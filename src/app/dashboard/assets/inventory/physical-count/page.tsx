import Link from "next/link"
import { Button } from "@/components/ui/button"
import { getUserPermissions } from "@/lib/actions/roles"
import { getInventoryList } from "@/lib/actions/inventory"
import { Forbidden } from "@/components/shared/forbidden"
import { PhysicalCountForm } from "@/components/inventory/physical-count-form"
import { ArrowLeft } from "lucide-react"

export default async function PhysicalCountPage() {
  const permissions = await getUserPermissions()

  const canManage = permissions.some(p =>
    ["inventory.manage", "asset.manage"].includes(p)
  )

  if (!canManage) {
    return (
      <Forbidden message="You don't have permission to perform physical counts. Only Supply Officers and Division Admins can access this page." />
    )
  }

  const inventory = await getInventoryList()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/dashboard/assets/inventory" />}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Inventory
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Physical Count</h1>
        <p className="text-muted-foreground">
          Enter physical count quantities to reconcile system records with actual stock.
        </p>
      </div>

      <PhysicalCountForm inventory={inventory} />
    </div>
  )
}
