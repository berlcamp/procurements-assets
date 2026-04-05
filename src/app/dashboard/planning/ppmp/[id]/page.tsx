import { notFound } from "next/navigation"
import Link from "next/link"
import { getPpmpById, getCurrentPpmpVersion, getPpmpProjects, getPpmpUserPermissions, getPpmpRemarks } from "@/lib/actions/ppmp"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { Separator } from "@/components/ui/separator"
import { PpmpApprovalChain } from "@/components/planning/ppmp-approval-chain"
import { PpmpIndicativeFinalBadge } from "@/components/planning/ppmp-indicative-final-badge"
import { PpmpProjectTable } from "@/components/planning/ppmp-item-table"
import { PpmpReviewActions } from "@/components/planning/ppmp-review-actions"
import { EditIcon, HistoryIcon } from "lucide-react"
import { PpmpSubmitForReviewButton } from "@/components/planning/ppmp-submit-for-review-button"
import { PpmpCancelButton } from "@/components/planning/ppmp-cancel-button"
import { PpmpAmendmentButton } from "@/components/planning/ppmp-amendment-button"
import { PpmpRemarks } from "@/components/planning/ppmp-remarks"
import type { PpmpLotWithItems } from "@/types/database"

interface Props {
  params: Promise<{ id: string }>
}

export default async function PpmpDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const [ppmp, version, { data: { user: authUser } }, permissions, remarks] = await Promise.all([
    getPpmpById(id),
    getCurrentPpmpVersion(id),
    supabase.auth.getUser(),
    getPpmpUserPermissions(),
    getPpmpRemarks(id),
  ])
  if (!ppmp) notFound()

  const projects = version ? await getPpmpProjects(version.id) : []
  const office = ppmp.office as { name: string; code: string } | undefined
  const fy = ppmp.fiscal_year as { year: number } | undefined

  const isDraft = ppmp.status === "draft" || ppmp.status === "revision_required"
  const canCancel = authUser?.id === ppmp.created_by && ppmp.status === "draft"
  const canAmend = authUser?.id === ppmp.created_by && (ppmp.status === "approved" || ppmp.status === "locked")

  // Only show review actions when this user has a role matching the current status
  const hasActionableReview =
    (ppmp.status === "submitted" && permissions.canChiefReview) ||
    (ppmp.status === "chief_reviewed" && permissions.canCertify) ||
    (ppmp.status === "budget_certified" && permissions.canApprove)

  // Count projects and total lots
  const projectCount = projects.length
  const lotCount = projects.reduce((sum, p) => sum + (p.ppmp_lots?.length ?? 0), 0)
  const itemCount = projects.reduce((sum, p) => {
    return sum + (p.ppmp_lots ?? []).reduce(
      (s, l) => s + ((l as PpmpLotWithItems).ppmp_lot_items?.length ?? 0), 0
    )
  }, 0)
  const computedTotalBudget = projects.reduce((sum, p) => {
    return sum + (p.ppmp_lots ?? []).reduce((lotSum, l) => {
      const items = (l as PpmpLotWithItems).ppmp_lot_items ?? []
      return lotSum + items.reduce((itemSum, item) =>
        itemSum + parseFloat(item.estimated_total_cost || "0"), 0)
    }, 0)
  }, 0)

  return (
    <div className="space-y-6">
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
        <div className="flex flex-wrap items-center gap-2">
          {isDraft && (
            <>
              <PpmpSubmitForReviewButton
                ppmpId={ppmp.id}
                disabled={projectCount === 0}
              />
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/dashboard/planning/ppmp/${ppmp.id}/edit`} />}>
                <EditIcon className="mr-1.5 h-3.5 w-3.5" />
                Edit
              </Button>
              {canCancel ? <PpmpCancelButton ppmpId={ppmp.id} /> : null}
            </>
          )}
          {canAmend && <PpmpAmendmentButton ppmpId={ppmp.id} />}
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

          {hasActionableReview && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-5 py-4 border-b">
                <h2 className="text-lg font-semibold">Review Actions</h2>
              </div>
              <div className="p-5">
                <PpmpReviewActions
                  ppmpId={ppmp.id}
                  ppmpStatus={ppmp.status}
                  canChiefReview={permissions.canChiefReview}
                  canCertify={permissions.canCertify}
                  canApprove={permissions.canApprove}
                  canReturn={permissions.canReturn}
                />
              </div>
            </div>
          )}

          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="text-lg font-semibold">Remarks</h2>
            </div>
            <div className="p-5">
              <PpmpRemarks
                ppmpId={ppmp.id}
                remarks={remarks}
                canAddRemark={permissions.canReturn}
              />
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
              <Separator />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Budget</span>
                <AmountDisplay amount={computedTotalBudget} className="font-semibold" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
