import Link from "next/link"
import { getDivisions } from "@/lib/actions/divisions"
import { getPlatformAuditLogs } from "@/lib/actions/platform-audit"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Building2, Users, AlertCircle, CheckCircle2 } from "lucide-react"

export default async function PlatformPage() {
  const [divisions, auditLogs] = await Promise.all([
    getDivisions(),
    getPlatformAuditLogs({ limit: 5 }),
  ])

  const totalDivisions = divisions.length
  const activeDivisions = divisions.filter(
    (d) => d.subscription_status === "active"
  ).length
  const trialDivisions = divisions.filter(
    (d) => d.subscription_status === "trial"
  ).length
  const suspendedDivisions = divisions.filter(
    (d) => d.subscription_status === "suspended"
  ).length

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Platform Administration</h1>
          <p className="text-muted-foreground">
            Manage all DepEd divisions from here.
          </p>
        </div>
        <Link href="/platform/divisions/new">
          <Button>Onboard Division</Button>
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Total Divisions</CardDescription>
            <CardTitle className="text-3xl">{totalDivisions}</CardTitle>
          </CardHeader>
          <CardContent>
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Active</CardDescription>
            <CardTitle className="text-3xl text-green-700">
              {activeDivisions}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Trial</CardDescription>
            <CardTitle className="text-3xl text-blue-700">
              {trialDivisions}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Users className="h-5 w-5 text-blue-600" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Suspended</CardDescription>
            <CardTitle className="text-3xl text-red-700">
              {suspendedDivisions}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AlertCircle className="h-5 w-5 text-red-600" />
          </CardContent>
        </Card>
      </div>

      {/* Recent audit logs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Last 5 platform audit log entries</CardDescription>
        </CardHeader>
        <CardContent>
          {auditLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {auditLogs.map((log) => (
                <li
                  key={log.id}
                  className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {formatAction(log.action)}
                    </p>
                    {log.division_name && (
                      <p className="text-xs text-muted-foreground">
                        Division: {log.division_name}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(log.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="flex gap-3">
        <Link href="/platform/divisions">
          <Button variant="outline">View All Divisions</Button>
        </Link>
        <Link href="/platform/audit-logs">
          <Button variant="outline">View Audit Logs</Button>
        </Link>
      </div>
    </div>
  )
}
