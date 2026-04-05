"use client"

import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/shared/data-table"
import type { AuditLog } from "@/types/database"
import type { Column, FilterDef } from "@/components/shared/data-table"

function actionVariant(
  action: string
): "default" | "secondary" | "destructive" | "outline" {
  if (action === "INSERT") return "default"
  if (action === "UPDATE") return "secondary"
  if (action === "DELETE") return "destructive"
  return "outline"
}

const columns: Column<AuditLog>[] = [
  {
    key: "created_at",
    header: "When",
    render: (row) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {new Date(row.created_at).toLocaleString("en-PH", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </span>
    ),
  },
  {
    key: "action",
    header: "Action",
    render: (row) => (
      <Badge variant={actionVariant(row.action)} className="text-xs">
        {row.action}
      </Badge>
    ),
  },
  {
    key: "table_name",
    header: "Table",
    render: (row) => (
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
        {row.table_name.replace("procurements.", "")}
      </code>
    ),
  },
  {
    key: "record_id",
    header: "Record",
    render: (row) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.record_id?.slice(0, 8) ?? "—"}
      </span>
    ),
  },
  {
    key: "changed_fields",
    header: "Changed Fields",
    render: (row) => (
      <span className="text-xs text-muted-foreground">
        {row.changed_fields?.join(", ") ?? "—"}
      </span>
    ),
  },
  {
    key: "user_id",
    header: "User",
    render: (row) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.user_id?.slice(0, 8) ?? "—"}
      </span>
    ),
  },
]

const filters: FilterDef<AuditLog>[] = [
  {
    key: "action",
    label: "Action",
    options: [
      { label: "INSERT", value: "INSERT" },
      { label: "UPDATE", value: "UPDATE" },
      { label: "DELETE", value: "DELETE" },
    ],
  },
]

export function AuditLogsTable({ data }: { data: AuditLog[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchable
      searchPlaceholder="Search by table or action..."
      emptyMessage="No audit log entries yet."
      filters={filters}
      pageSize={50}
    />
  )
}
