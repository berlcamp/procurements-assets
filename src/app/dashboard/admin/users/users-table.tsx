"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { EyeIcon } from "lucide-react"
import { DataTable } from "@/components/shared/data-table"
import { Badge } from "@/components/ui/badge"
import type { UserProfileForTable } from "@/types/database"
import type { Column, FilterDef, RowAction } from "@/components/shared/data-table"

function fullName(u: UserProfileForTable): string {
  const parts = [u.first_name, u.middle_name, u.last_name]
    .filter(Boolean)
    .join(" ")
  return u.suffix ? `${parts}, ${u.suffix}` : parts
}

const columns: Column<UserProfileForTable>[] = [
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
    key: "email",
    header: "Email",
    render: (row) => (
      <span className="text-sm text-muted-foreground">
        {row.email ?? "—"}
      </span>
    ),
  },
  {
    key: "roles",
    header: "Roles",
    render: (row) =>
      row.roles && row.roles.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.roles.map((r) => (
            <Badge key={r.id} variant="secondary" className="text-xs">
              {r.display_name}
            </Badge>
          ))}
        </div>
      ) : (
        <span className="text-muted-foreground text-xs">No roles</span>
      ),
  },
  {
    key: "office_id",
    header: "Office",
    render: (row) => (
      <span className="text-sm">
        {row.office?.name ?? <span className="text-muted-foreground">—</span>}
      </span>
    ),
  },
  {
    key: "employee_id",
    header: "Employee ID",
    defaultHidden: true,
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
    defaultHidden: true,
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

const filters: FilterDef<UserProfileForTable>[] = [
  {
    key: "is_active",
    label: "Status",
    options: [
      { label: "Active", value: "true" },
      { label: "Inactive", value: "false" },
    ],
  },
]

export function UsersTable({ data }: { data: UserProfileForTable[] }) {
  const router = useRouter()

  const rowActions: RowAction<UserProfileForTable>[] = [
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
      searchPlaceholder="Search by name, email, or office…"
      emptyMessage="No users yet. Invite your first user."
      filters={filters}
      rowActions={rowActions}
      columnToggle
    />
  )
}
