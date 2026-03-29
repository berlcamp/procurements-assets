import { getPlatformAuditLogs } from "@/lib/actions/platform-audit"
import { AuditLogsTable } from "./audit-logs-table"

export default async function AuditLogsPage() {
  const logs = await getPlatformAuditLogs({ limit: 100 })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Audit Logs</h1>
        <p className="text-muted-foreground">
          Track all Super Admin actions on the platform. Showing last 100
          entries.
        </p>
      </div>

      <AuditLogsTable data={logs} />
    </div>
  )
}
