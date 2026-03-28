import Link from "next/link"
import { getDivisions } from "@/lib/actions/divisions"
import { DataTable } from "@/components/shared/data-table"
import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import type { Division } from "@/types/database"
import type { Column } from "@/components/shared/data-table"

export default async function DivisionsPage() {
  const divisions = await getDivisions()

  const columns: Column<Division>[] = [
    {
      key: "name",
      header: "Division Name",
      render: (row) => (
        <Link
          href={`/platform/divisions/${row.id}`}
          className="font-medium hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: "code",
      header: "Code",
    },
    {
      key: "region",
      header: "Region",
    },
    {
      key: "subscription_status",
      header: "Status",
      render: (row) => <StatusBadge status={row.subscription_status} />,
    },
    {
      key: "max_users",
      header: "Max Users",
      render: (row) => <span>{row.max_users.toLocaleString()}</span>,
    },
    {
      key: "created_at",
      header: "Created",
      render: (row) =>
        new Date(row.created_at).toLocaleDateString("en-PH", {
          dateStyle: "medium",
        }),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Divisions</h1>
          <p className="text-muted-foreground">
            All onboarded DepEd divisions.
          </p>
        </div>
        <Button asChild>
          <Link href="/platform/divisions/new">Onboard Division</Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={divisions as unknown as Record<string, unknown>[]}
        searchable
        searchPlaceholder="Search by name, code, or region..."
        emptyMessage="No divisions onboarded yet."
      />
    </div>
  )
}
