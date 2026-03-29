"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { EyeIcon } from "lucide-react"
import { DataTable } from "@/components/shared/data-table"
import { Badge } from "@/components/ui/badge"
import type { UserProfile } from "@/types/database"
import type { Column, FilterDef, RowAction } from "@/components/shared/data-table"

function fullName(u: UserProfile): string {
  const parts = [u.first_name, u.middle_name, u.last_name]
    .filter(Boolean)
    .join(" ")
  return u.suffix ? `${parts}, ${u.suffix}` : parts
}

const columns: Column<UserProfile>[] = [
  {
    key: "last_name",
    header: "Name",
    hideable: false,
    render: (row) => (
      <Link
        href={`/dashboard/admin/users/${row.id}`}
        className="font-medium hover:underline"
      >
        {fullName(row)}
      </Link>
    ),
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
    render: (row) => <span className="text-sm">{row.position ?? "—"}</span>,
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
  {
    key: "created_at",
    header: "Added",
    defaultHidden: true,
    render: (row) =>
      new Date(row.created_at).toLocaleDateString("en-PH", {
        dateStyle: "medium",
      }),
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

export function UsersTable({ data }: { data: UserProfile[] }) {
  const router = useRouter()

  const rowActions: RowAction<UserProfile>[] = [
    {
      label: "View Profile",
      icon: <EyeIcon />,
      onClick: (row) => router.push(`/dashboard/admin/users/${row.id}`),
    },
  ]

  return (
    <DataTable
      columns={columns}
      data={data}
      searchable
      searchPlaceholder="Search by name, employee ID, or position…"
      emptyMessage="No users yet. Invite your first user."
      filters={filters}
      rowActions={rowActions}
      columnToggle
    />
  )
}
