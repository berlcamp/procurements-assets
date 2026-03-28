import { getPlatformAuditLogs } from "@/lib/actions/platform-audit"
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

export default async function AuditLogsPage() {
  const logs = await getPlatformAuditLogs({ limit: 100 })

  const columns: Column<PlatformAuditLogWithDivision>[] = [
    {
      key: "action",
      header: "Action",
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Audit Logs</h1>
        <p className="text-muted-foreground">
          Track all Super Admin actions on the platform. Showing last 100
          entries.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={logs}
        searchable
        searchPlaceholder="Search by action or division..."
        emptyMessage="No audit log entries found."
      />
    </div>
  )
}
