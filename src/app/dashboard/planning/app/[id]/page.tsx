import { notFound } from "next/navigation"
import Link from "next/link"
import {
  getAppById, getCurrentAppVersion, getAppItems, getAppSummary, getAppUserPermissions,
} from "@/lib/actions/app"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { PpmpIndicativeFinalBadge } from "@/components/planning/ppmp-indicative-final-badge"
import { AppItemsTable } from "@/components/planning/app-items-table"
import { AppStatusDashboard } from "@/components/planning/app-status-dashboard"
import { AppWorkflowActions } from "@/components/planning/app-workflow-actions"
import { ClipboardCheck, Layers, HistoryIcon } from "lucide-react"

interface Props {
  params: Promise<{ id: string }>
}

export default async function AppDetailPage({ params }: Props) {
  const { id } = await params
  const [app, version, permissions] = await Promise.all([
    getAppById(id),
    getCurrentAppVersion(id),
    getAppUserPermissions(id),
  ])
  if (!app) notFound()

  const [items, summary] = await Promise.all([
    version ? getAppItems(version.id) : Promise.resolve([]),
    getAppSummary(id),
  ])

  const fy = app.fiscal_year as { year: number } | undefined

  // Build ppmpId → creator name map for the items table
  const supabase = await createClient()
  const ppmpIds = [...new Set(items.map(i => i.source_ppmp_id).filter((v): v is string => !!v))]
  let creatorsByPpmpId: Record<string, string> = {}
  if (ppmpIds.length > 0) {
    const { data: ppmps } = await supabase.schema("procurements").from("ppmps")
      .select("id, created_by")
      .in("id", ppmpIds)
    const creatorIds = [...new Set((ppmps ?? []).map(p => p.created_by).filter((v): v is string => !!v))]
    if (creatorIds.length > 0) {
      const { data: profiles } = await supabase.schema("procurements").from("user_profiles")
        .select("id, first_name, last_name")
        .in("id", creatorIds)
      const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, `${p.first_name} ${p.last_name}`.trim()]))
      creatorsByPpmpId = Object.fromEntries(
        (ppmps ?? []).map(p => [p.id, p.created_by ? (profileMap[p.created_by] ?? "—") : "—"])
      )
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">
              Annual Procurement Plan — FY {fy?.year ?? "—"}
            </h1>
            <PpmpIndicativeFinalBadge value={app.indicative_final} />
          </div>
          <p className="text-base text-muted-foreground">
            Version {app.current_version} · <StatusBadge status={app.status} />
          </p>
        </div>
        <div className="flex gap-2">
          {permissions.canHopeReview && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/dashboard/planning/app/${app.id}/review`} />}>
              <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
              HOPE Review
            </Button>
          )}
          {permissions.canViewLots && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/dashboard/planning/app/${app.id}/lots`} />}>
              <Layers className="mr-1.5 h-3.5 w-3.5" />
              BAC Lots
            </Button>
          )}
          <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/planning/app/${app.id}/versions`} />}>
            <HistoryIcon className="mr-1.5 h-3.5 w-3.5" />
            History
          </Button>
          <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/dashboard/planning/app" />}>
            Back
          </Button>
        </div>
      </div>

      {/* Status Dashboard */}
      {summary && <AppStatusDashboard summary={summary} />}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main — items table */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">APP Items</h2>
              <p className="text-sm text-muted-foreground">
                PPMP rows auto-populated from approved PPMPs
              </p>
            </div>
            <div className="p-0">
              <AppItemsTable items={items} creatorsByPpmpId={creatorsByPpmpId} />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">Summary</h2>
            </div>
            <div className="p-5 space-y-2 text-base">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fiscal Year</span>
                <span className="font-medium">FY {fy?.year ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-mono font-medium">v{app.current_version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={app.status} />
              </div>
              {summary && (
                <>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Items</span>
                    <span className="font-medium">{summary.total_items}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Lots</span>
                    <span className="font-medium">{summary.total_lots}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Budget</span>
                    <AmountDisplay amount={summary.total_budget} className="font-semibold" />
                  </div>
                </>
              )}
              {app.approved_at && (
                <>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Approved</span>
                    <span className="text-sm">{new Date(app.approved_at).toLocaleDateString("en-PH")}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Workflow actions */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">Actions</h2>
            </div>
            <div className="p-5">
              <AppWorkflowActions
                appId={app.id}
                appStatus={app.status}
                canFinalizeApp={permissions.canFinalizeApp}
                canApproveApp={permissions.canApproveApp}
              />
              {!permissions.canFinalizeApp && !permissions.canApproveApp && (
                <p className="text-xs text-muted-foreground">
                  Actions are available to authorized roles (HOPE, BAC) at the relevant stage.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
