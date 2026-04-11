import Link from "next/link"
import { getOfficeTree } from "@/lib/actions/offices"
import { getUserPermissions } from "@/lib/actions/roles"
import { Button } from "@/components/ui/button"
import { Forbidden } from "@/components/shared/forbidden"
import { OfficesTable } from "./offices-table"

export default async function OfficesPage() {
  const permissions = await getUserPermissions()
  if (!permissions.includes("offices.manage")) {
    return (
      <Forbidden
        message="You don't have permission to manage offices. Only roles with offices.manage (e.g., Division Admin, HOPE) can access this page."
      />
    )
  }

  const tree = await getOfficeTree()
  const canAdd = permissions.includes("offices.manage")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Offices</h1>
          <p className="text-muted-foreground">
            Manage offices, schools, and sections in your division.
          </p>
        </div>
        {canAdd && (
          <Link href="/dashboard/admin/offices/new">
            <Button>Add Office</Button>
          </Link>
        )}
      </div>

      <OfficesTable tree={tree} />
    </div>
  )
}
