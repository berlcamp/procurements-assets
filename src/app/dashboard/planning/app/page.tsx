import Link from "next/link"
import { getApps, getAppsRequiringMyAction } from "@/lib/actions/app"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import type { AppWithDetails } from "@/types/database"

function AppTable({ apps }: { apps: AppWithDetails[] }) {
  if (apps.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No APPs found. APPs are automatically created when PPMPs are approved.
        </p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fiscal Year</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>INDICATIVE / FINAL</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-[60px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {apps.map((app) => {
          const fy = app.fiscal_year as { year: number } | undefined
          return (
            <TableRow key={app.id}>
              <TableCell className="font-medium">FY {fy?.year ?? "—"}</TableCell>
              <TableCell>
                <span className="font-mono text-sm">v{app.current_version}</span>
              </TableCell>
              <TableCell><StatusBadge status={app.status} /></TableCell>
              <TableCell>
                <Badge variant={app.indicative_final === "final" ? "default" : "outline"}>
                  {app.indicative_final.toUpperCase()}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(app.created_at).toLocaleDateString("en-PH")}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/dashboard/planning/app/${app.id}`} />}>
                  View
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export default async function AppListPage() {
  const [apps, actionApps] = await Promise.all([
    getApps(),
    getAppsRequiringMyAction(),
  ])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Annual Procurement Plan</h1>
        <p className="text-sm text-muted-foreground">
          Division-wide procurement plan auto-populated from approved PPMPs
        </p>
      </div>

      {/* APP That Requires My Action */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="text-lg font-semibold">APP That Requires My Action</h2>
          <p className="text-sm text-muted-foreground">
            APPs currently awaiting your review or approval
          </p>
        </div>
        <div className="p-0">
          {actionApps.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No APPs require your action.</p>
            </div>
          ) : (
            <AppTable apps={actionApps} />
          )}
        </div>
      </section>

      {/* All APPs */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="text-lg font-semibold">APPs</h2>
          <p className="text-sm text-muted-foreground">
            One APP per fiscal year per division
          </p>
        </div>
        <div className="p-0">
          <AppTable apps={apps} />
        </div>
      </section>
    </div>
  )
}
