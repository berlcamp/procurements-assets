"use client"

import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/shared/data-table"
import type { UserProfile } from "@/types/database"
import type { Column, FilterDef } from "@/components/shared/data-table"

function fullName(u: UserProfile): string {
  const parts = [u.first_name, u.middle_name, u.last_name].filter(Boolean).join(" ")
  return u.suffix ? `${parts}, ${u.suffix}` : parts
}

const columns: Column<UserProfile>[] = [
  {
    key: "last_name",
    header: "Name",
    hideable: false,
    render: (row) => <span className="font-medium">{fullName(row)}</span>,
  },
  {
    key: "employee_id",
    header: "Employee ID",
    render: (row) =>
      row.employee_id ? (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {row.employee_id}
        </code>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "position",
    header: "Position",
    render: (row) => (
      <span className="text-muted-foreground">{row.position ?? "—"}</span>
    ),
  },
  {
    key: "is_active",
    header: "Status",
    render: (row) => (
      <Badge variant={row.is_active ? "default" : "outline"}>
        {row.is_active ? "Active" : "Inactive"}
      </Badge>
    ),
  },
]

const filters: FilterDef<UserProfile>[] = [
  {
    key: "is_active",
    label: "Status",
    options: [
      { label: "Active", value: "true" },
      { label: "Inactive", value: "false" },
    ],
  },
]

export function DivisionUsersTable({ data }: { data: UserProfile[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchable
      searchPlaceholder="Search by name, employee ID, or position..."
      emptyMessage="No users found for this division."
      filters={filters}
      columnToggle
    />
  )
}
