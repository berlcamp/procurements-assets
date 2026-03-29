import { notFound } from "next/navigation"
import Link from "next/link"
import { getPpmpById, getCurrentPpmpVersion, getPpmpProjects } from "@/lib/actions/ppmp"
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { PpmpApprovalChain } from "@/components/planning/ppmp-approval-chain"
import { PpmpIndicativeFinalBadge } from "@/components/planning/ppmp-indicative-final-badge"
import { PpmpProjectTable } from "@/components/planning/ppmp-item-table"
import { PpmpReviewActions } from "@/components/planning/ppmp-review-actions"
import { AmountDisplay } from "@/components/shared/amount-display"
import { Separator } from "@/components/ui/separator"

interface Props {
  params: Promise<{ id: string }>
}

export default async function PpmpReviewPage({ params }: Props) {
  const { id } = await params
  const [ppmp, version] = await Promise.all([
    getPpmpById(id),
    getCurrentPpmpVersion(id),
  ])
  if (!ppmp) notFound()

  const projects = version ? await getPpmpProjects(version.id) : []
  const office = ppmp.office as { name: string; code: string } | undefined
  const fy = ppmp.fiscal_year as { year: number } | undefined

  const reviewable = ["submitted","chief_reviewed","budget_certified"].includes(ppmp.status)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">PPMP Review — {office?.name}</h1>
            <PpmpIndicativeFinalBadge value={ppmp.indicative_final} />
          </div>
          <p className="text-sm text-muted-foreground">
            FY {fy?.year} · <StatusBadge status={ppmp.status} />
          </p>
        </div>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/dashboard/planning/ppmp/${id}`} />}>
          Back to Detail
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Procurement Projects</CardTitle></CardHeader>
            <CardContent>
              <PpmpProjectTable projects={projects} editable={false} />
            </CardContent>
          </Card>

          {reviewable && (
            <Card>
              <CardHeader><CardTitle className="text-base">Your Action</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <PpmpReviewActions
                  ppmpId={ppmp.id}
                  ppmpStatus={ppmp.status}
                  canChiefReview={ppmp.status === "submitted"}
                  canCertify={ppmp.status === "chief_reviewed"}
                  canApprove={ppmp.status === "budget_certified"}
                  canReturn={true}
                />
                <p className="text-xs text-muted-foreground">
                  Role-based permission enforcement is applied by RLS on the server.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Approval Progress</CardTitle></CardHeader>
            <CardContent><PpmpApprovalChain ppmp={ppmp} /></CardContent>
          </Card>

          {version && (
            <Card>
              <CardHeader><CardTitle className="text-base">Version Summary</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <span className="font-mono">v{version.version_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span>{version.version_type}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Projects</span>
                  <span>{projects.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Budget</span>
                  <AmountDisplay amount={version.total_estimated_budget} className="font-semibold" />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
