"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { EyeIcon, SettingsIcon, UsersIcon } from "lucide-react"
import { DataTable } from "@/components/shared/data-table"
import { StatusBadge } from "@/components/shared/status-badge"
import type { Division } from "@/types/database"
import type { Column, FilterDef, RowAction } from "@/components/shared/data-table"

const columns: Column<Division>[] = [
  {
    key: "name",
    header: "Division Name",
    hideable: false,
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
    defaultHidden: true,
    render: (row) =>
      new Date(row.created_at).toLocaleDateString("en-PH", {
        dateStyle: "medium",
      }),
  },
]

const filters: FilterDef<Division>[] = [
  {
    key: "subscription_status",
    label: "Status",
    options: [
      { label: "Pending", value: "pending" },
      { label: "Trial", value: "trial" },
      { label: "Active", value: "active" },
      { label: "Suspended", value: "suspended" },
      { label: "Expired", value: "expired" },
    ],
  },
]

export function DivisionsTable({ data }: { data: Division[] }) {
  const router = useRouter()

  const rowActions: RowAction<Division>[] = [
    {
      label: "View Details",
      icon: <EyeIcon />,
      onClick: (row) => router.push(`/platform/divisions/${row.id}`),
    },
    {
      label: "Settings",
      icon: <SettingsIcon />,
      onClick: (row) => router.push(`/platform/divisions/${row.id}/settings`),
    },
    {
      label: "Manage Users",
      icon: <UsersIcon />,
      onClick: (row) => router.push(`/platform/divisions/${row.id}/users`),
    },
  ]

  return (
    <DataTable
      columns={columns}
      data={data}
      searchable
      searchPlaceholder="Search by name, code, or region..."
      emptyMessage="No divisions onboarded yet."
      filters={filters}
      rowActions={rowActions}
      columnToggle
    />
  )
}
