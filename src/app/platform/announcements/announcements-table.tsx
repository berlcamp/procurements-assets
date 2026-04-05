"use client"

import { DataTable } from "@/components/shared/data-table"
import { StatusBadge } from "@/components/shared/status-badge"
import type { Announcement } from "@/types/database"
import type { Column, FilterDef } from "@/components/shared/data-table"

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-PH", { dateStyle: "medium" })
}

const columns: Column<Announcement>[] = [
  {
    key: "title",
    header: "Title",
    render: (row) => <span className="font-medium">{row.title}</span>,
  },
  {
    key: "type",
    header: "Type",
    render: (row) => <StatusBadge status={row.type} />,
  },
  {
    key: "is_active",
    header: "Active",
    render: (row) => (
      <StatusBadge status={row.is_active ? "active" : "suspended"} />
    ),
  },
  {
    key: "published_at",
    header: "Published At",
    render: (row) => formatDate(row.published_at),
  },
  {
    key: "expires_at",
    header: "Expires At",
    render: (row) => formatDate(row.expires_at),
  },
]

const filters: FilterDef<Announcement>[] = [
  {
    key: "type",
    label: "Type",
    options: [
      { label: "Info", value: "info" },
      { label: "Warning", value: "warning" },
      { label: "Critical", value: "critical" },
      { label: "Maintenance", value: "maintenance" },
    ],
  },
  {
    key: "is_active",
    label: "Visibility",
    options: [
      { label: "Active", value: "true" },
      { label: "Inactive", value: "false" },
    ],
  },
]

export function AnnouncementsTable({ data }: { data: Announcement[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchable
      searchPlaceholder="Search by title..."
      emptyMessage="No announcements found."
      filters={filters}
    />
  )
}
