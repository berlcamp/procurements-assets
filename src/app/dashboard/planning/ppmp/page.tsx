import Link from "next/link"
import {
  getMyPpmps,
  getPpmpsRequiringMyAction,
  getAllDivisionPpmps,
  getFailedConsolidationPpmps,
} from "@/lib/actions/ppmp"
import { getUserPermissions } from "@/lib/actions/roles"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { PlanningStageBadge } from "@/components/planning/ppmp-indicative-final-badge"
import { ConsolidationStatusBadge } from "@/components/planning/consolidation-status-badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { PlusIcon, TriangleAlertIcon } from "lucide-react"
import type { PpmpWithDetails } from "@/types/database"

function PpmpTable({
  ppmps,
  showCreator = false,
}: {
  ppmps: PpmpWithDetails[]
  showCreator?: boolean
}) {
  if (ppmps.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">No PPMPs found.</p>
      </div>
    )
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Office</TableHead>
            <TableHead>Fiscal Year</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>PLANNING STAGE</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {ppmps.map((ppmp: PpmpWithDetails) => {
            const office = ppmp.office as { name: string; code: string } | undefined
            const fy = ppmp.fiscal_year as { year: number } | undefined
            return (
              <TableRow key={ppmp.id}>
                <TableCell className="font-medium">{office?.name ?? "—"}</TableCell>
                <TableCell>{fy?.year ?? "—"}</TableCell>
                <TableCell>
                  <span className="font-mono text-sm">v{ppmp.current_version}</span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={ppmp.status} />
                    {/* Only the failure is surfaced here. 'pending' is the
                        column default on every draft, so badging it would be
                        noise; the detail page shows the full state. */}
                    {ppmp.consolidation_status === "failed" ? (
                      <ConsolidationStatusBadge status={ppmp.consolidation_status} />
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  {/* Stage of the current version. null = unknown (no qualifying
                      budget ceiling), shown as a dash rather than a guess. */}
                  {ppmp.current_planning_stage ? (
                    <PlanningStageBadge value={ppmp.current_planning_stage} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <div className="space-y-1">
                    <div>{new Date(ppmp.created_at).toLocaleDateString("en-PH")}</div>
                    {showCreator && ppmp.creator ? (
                      <div className="text-xs leading-snug">
                        <div className="font-medium text-foreground">{ppmp.creator.full_name}</div>
                        {ppmp.creator.office_name ? (
                          <div className="text-muted-foreground">{ppmp.creator.office_name}</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/dashboard/planning/ppmp/${ppmp.id}`} />}>
                    View
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function FailedConsolidationPanel({ ppmps }: { ppmps: PpmpWithDetails[] }) {
  return (
    <section className="rounded-lg border border-destructive/40 bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-destructive/40">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-destructive">
          <TriangleAlertIcon className="h-4 w-4" />
          Approved, but missing from the APP
        </h2>
        <p className="text-sm text-muted-foreground">
          {ppmps.length === 1
            ? "1 approved PPMP did not reach the Annual Procurement Plan."
            : `${ppmps.length} approved PPMPs did not reach the Annual Procurement Plan.`}{" "}
          Their items are absent from the plan. Recovering them requires an APP
          amendment.
        </p>
      </div>
      <ul className="divide-y">
        {ppmps.map((ppmp) => {
          const office = ppmp.office as { name: string } | undefined
          const fy = ppmp.fiscal_year as { year: number } | undefined
          return (
            <li
              key={ppmp.id}
              className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
            >
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">
                  {office?.name ?? "—"}
                  <span className="text-muted-foreground font-normal">
                    {" · "}FY {fy?.year ?? "—"}
                    {" · "}v{ppmp.current_version}
                  </span>
                </div>
                {/* The reason is written by record_consolidation_failure() and
                    is already phrased for a human. Show it verbatim rather than
                    re-summarising it — it is the only place the cause is kept. */}
                <p className="text-sm text-muted-foreground">
                  {ppmp.consolidation_error ?? "No reason was recorded."}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/dashboard/planning/ppmp/${ppmp.id}`} />}
              >
                View
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default async function PpmpListPage() {
  const [myPpmps, actionPpmps, allDivisionPpmps, failedPpmps, permissions] = await Promise.all([
    getMyPpmps(),
    getPpmpsRequiringMyAction(),
    getAllDivisionPpmps(),
    getFailedConsolidationPpmps(),
    getUserPermissions(),
  ])

  const canCreate = permissions.includes("ppmp.create")

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">PPMP</h1>
          <p className="text-sm text-muted-foreground">
            Project Procurement Management Plans
          </p>
        </div>
        {canCreate && (
          <Button nativeButton={false} render={<Link href="/dashboard/planning/ppmp/new" />}>
            <PlusIcon className="mr-1.5 h-4 w-4" />
            New PPMP
          </Button>
        )}
      </div>

      {/* Consolidation failures come first: an approved PPMP missing from the
          APP is the one state on this screen where the office's belief and the
          record disagree, and the notification that reports it may be missed. */}
      {failedPpmps.length > 0 && <FailedConsolidationPanel ppmps={failedPpmps} />}

      {/* PPMP That Requires My Action */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="text-lg font-semibold">PPMP That Requires My Action</h2>
          <p className="text-sm text-muted-foreground">
            PPMPs currently awaiting your review, approval, or revision
          </p>
        </div>
        <div className="p-0">
          <PpmpTable ppmps={actionPpmps} />
        </div>
      </section>

      {/* My PPMP */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="text-lg font-semibold">My PPMP</h2>
          <p className="text-sm text-muted-foreground">
            PPMPs you created
          </p>
        </div>
        <div className="p-0">
          {myPpmps.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No PPMPs yet.</p>
              {canCreate && (
                <Button variant="outline" size="sm" className="mt-3" nativeButton={false} render={<Link href="/dashboard/planning/ppmp/new" />}>
                  Create your first PPMP
                </Button>
              )}
            </div>
          ) : (
            <PpmpTable ppmps={myPpmps} showCreator />
          )}
        </div>
      </section>

      {/* All Division PPMPs — only rendered for roles with ppmp.view_all */}
      {allDivisionPpmps !== null && (
        <section className="rounded-lg border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h2 className="text-lg font-semibold">All Division PPMPs</h2>
            <p className="text-sm text-muted-foreground">
              All PPMPs submitted across every office in this division
            </p>
          </div>
          <div className="p-0">
            <PpmpTable ppmps={allDivisionPpmps} showCreator />
          </div>
        </section>
      )}
    </div>
  )
}
