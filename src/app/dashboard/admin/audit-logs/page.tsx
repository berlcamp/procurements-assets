import { getAuditLogs } from "@/lib/actions/admin-audit-logs"
import { AuditLogsTable } from "./audit-logs-table"

export default async function AuditLogsPage() {
  const { data: logs } = await getAuditLogs({ limit: 500 })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <p className="text-muted-foreground">
          Track all changes made within your division.
        </p>
      </div>

      <AuditLogsTable data={logs} />
    </div>
  )
}
