import Link from "next/link"
import { getOfficeTree } from "@/lib/actions/offices"
import { Button } from "@/components/ui/button"
import { OfficesTable } from "./offices-table"

export default async function OfficesPage() {
  const tree = await getOfficeTree()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Offices</h1>
          <p className="text-muted-foreground">
            Manage offices, schools, and sections in your division.
          </p>
        </div>
        <Link href="/dashboard/admin/offices/new">
          <Button>Add Office</Button>
        </Link>
      </div>

      <OfficesTable tree={tree} />
    </div>
  )
}
