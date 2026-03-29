"use client"

import { DataTable } from "@/components/shared/data-table"
import type { PlatformAuditLogWithDivision } from "@/lib/actions/platform-audit"
import type { Column } from "@/components/shared/data-table"

function formatAction(action: string): string {
  return action
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function formatDetails(details: Record<string, unknown> | null): string {
  if (!details) return "—"
  const str = JSON.stringify(details)
  return str.length > 80 ? str.substring(0, 80) + "..." : str
}

const columns: Column<PlatformAuditLogWithDivision>[] = [
  {
    key: "action",
    header: "Action",
    hideable: false,
    render: (row) => (
      <span className="font-medium">{formatAction(row.action)}</span>
    ),
  },
  {
    key: "division_name",
    header: "Division",
    render: (row) => (
      <span className="text-muted-foreground">
        {row.division_name ?? "—"}
      </span>
    ),
  },
  {
    key: "details",
    header: "Details",
    defaultHidden: true,
    render: (row) => (
      <span
        className="font-mono text-xs text-muted-foreground"
        title={row.details ? JSON.stringify(row.details) : undefined}
      >
        {formatDetails(row.details)}
      </span>
    ),
  },
  {
    key: "performed_by",
    header: "Performed By",
    defaultHidden: true,
    render: (row) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.performed_by ? row.performed_by.substring(0, 8) + "..." : "—"}
      </span>
    ),
  },
  {
    key: "created_at",
    header: "Date",
    render: (row) => formatDate(row.created_at),
  },
]

export function AuditLogsTable({
  data,
}: {
  data: PlatformAuditLogWithDivision[]
}) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchable
      searchPlaceholder="Search by action or division..."
      emptyMessage="No audit log entries found."
      columnToggle
      pageSize={50}
    />
  )
}
