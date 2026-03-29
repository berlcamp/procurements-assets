import Link from "next/link"
import { getDivisions } from "@/lib/actions/divisions"
import { Button } from "@/components/ui/button"
import { DivisionsTable } from "./divisions-table"

export default async function DivisionsPage() {
  const divisions = await getDivisions()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Divisions</h1>
          <p className="text-muted-foreground">
            All onboarded DepEd divisions.
          </p>
        </div>
        <Link href="/platform/divisions/new">
          <Button>Onboard Division</Button>
        </Link>
      </div>

      <DivisionsTable data={divisions} />
    </div>
  )
}
