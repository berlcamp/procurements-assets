import { getAuditLogs } from "@/lib/actions/admin-audit-logs"
import { getUserPermissions } from "@/lib/actions/roles"
import { Forbidden } from "@/components/shared/forbidden"
import { AuditLogsTable } from "./audit-logs-table"

export default async function AuditLogsPage() {
  const permissions = await getUserPermissions()
  if (!permissions.includes("division.audit_logs")) {
    return (
      <Forbidden
        message="You don't have permission to view audit logs. Only roles with division.audit_logs (e.g., Division Admin, Auditor) can access this page."
      />
    )
  }

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
