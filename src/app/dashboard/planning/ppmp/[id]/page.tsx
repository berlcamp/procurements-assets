import { notFound } from "next/navigation"
import Link from "next/link"
import { getPpmpById, getCurrentPpmpVersion, getPpmpProjects } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { Separator } from "@/components/ui/separator"
import { PpmpApprovalChain } from "@/components/planning/ppmp-approval-chain"
import { PpmpIndicativeFinalBadge } from "@/components/planning/ppmp-indicative-final-badge"
import { PpmpProjectTable } from "@/components/planning/ppmp-item-table"
import { PpmpReviewActions } from "@/components/planning/ppmp-review-actions"
import { EditIcon, HistoryIcon } from "lucide-react"
import type { PpmpLotWithItems } from "@/types/database"

interface Props {
  params: Promise<{ id: string }>
}

export default async function PpmpDetailPage({ params }: Props) {
  const { id } = await params
  const [ppmp, version] = await Promise.all([
    getPpmpById(id),
    getCurrentPpmpVersion(id),
  ])
  if (!ppmp) notFound()

  const projects = version ? await getPpmpProjects(version.id) : []
  const office = ppmp.office as { name: string; code: string } | undefined
  const fy = ppmp.fiscal_year as { year: number } | undefined

  const isDraft = ppmp.status === "draft" || ppmp.status === "revision_required"

  // Count projects and total lots
  const projectCount = projects.length
  const lotCount = projects.reduce((sum, p) => sum + (p.ppmp_lots?.length ?? 0), 0)
  const itemCount = projects.reduce((sum, p) => {
    return sum + (p.ppmp_lots ?? []).reduce(
      (s, l) => s + ((l as PpmpLotWithItems).ppmp_lot_items?.length ?? 0), 0
    )
  }, 0)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{office?.name ?? "PPMP"}</h1>
            <PpmpIndicativeFinalBadge value={ppmp.indicative_final} />
          </div>
          <p className="text-base text-muted-foreground">
            FY {fy?.year} · Version {ppmp.current_version} · <StatusBadge status={ppmp.status} />
          </p>
        </div>
        <div className="flex gap-2">
          {isDraft && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/dashboard/planning/ppmp/${ppmp.id}/edit`} />}>
              <EditIcon className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          )}
          <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/planning/ppmp/${ppmp.id}/versions`} />}>
            <HistoryIcon className="mr-1.5 h-3.5 w-3.5" />
            History
          </Button>
          <Button size="sm" variant="ghost" nativeButton={false} render={<Link href="/dashboard/planning/ppmp" />}>
            Back
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main — projects */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">Procurement Projects</h2>
            </div>
            <div className="p-5">
              <PpmpProjectTable projects={projects} editable={false} />
            </div>
          </div>

          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">Review Actions</h2>
            </div>
            <div className="p-5">
              <PpmpReviewActions
                ppmpId={ppmp.id}
                ppmpStatus={ppmp.status}
                canChiefReview={false}
                canCertify={false}
                canApprove={false}
                canReturn={false}
              />
              <p className="text-xs text-muted-foreground mt-2">
                Actions are available to authorized roles when PPMP is at the relevant stage.
              </p>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">Approval Chain</h2>
            </div>
            <div className="p-5">
              <PpmpApprovalChain ppmp={ppmp} />
            </div>
          </div>

          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">Summary</h2>
            </div>
            <div className="p-5 space-y-2 text-base">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Office</span>
                <span className="font-medium">{office?.name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fiscal Year</span>
                <span className="font-medium">FY {fy?.year ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-mono font-medium">v{ppmp.current_version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Projects</span>
                <span className="font-medium">{projectCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Lots</span>
                <span className="font-medium">{lotCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items</span>
                <span className="font-medium">{itemCount}</span>
              </div>
              {version && (
                <>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Budget</span>
                    <AmountDisplay amount={version.total_estimated_budget} className="font-semibold" />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
