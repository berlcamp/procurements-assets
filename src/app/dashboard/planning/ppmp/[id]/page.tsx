import { notFound } from "next/navigation"
import Link from "next/link"
import { getPpmpById, getCurrentPpmpVersion, getPpmpItems } from "@/lib/actions/ppmp"
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { Separator } from "@/components/ui/separator"
import { PpmpApprovalChain } from "@/components/planning/ppmp-approval-chain"
import { PpmpIndicativeFinalBadge } from "@/components/planning/ppmp-indicative-final-badge"
import { PpmpItemTable } from "@/components/planning/ppmp-item-table"
import { PpmpReviewActions } from "@/components/planning/ppmp-review-actions"
import { EditIcon, HistoryIcon } from "lucide-react"
import type { PpmpWithDetails, PpmpItemWithAllocation } from "@/types/database"

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

  const items = version ? await getPpmpItems(version.id) : []
  const office = ppmp.office as { name: string; code: string } | undefined
  const fy = ppmp.fiscal_year as { year: number } | undefined

  const isDraft = ppmp.status === "draft"

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{office?.name ?? "PPMP"}</h1>
            <PpmpIndicativeFinalBadge value={ppmp.indicative_final} />
          </div>
          <p className="text-sm text-muted-foreground">
            FY {fy?.year} · Version {ppmp.current_version} · <StatusBadge status={ppmp.status} />
          </p>
        </div>
        <div className="flex gap-2">
          {isDraft && (
            <Link href={`/dashboard/planning/ppmp/${ppmp.id}/edit`}>
              <Button size="sm" variant="outline">
                <EditIcon className="mr-1.5 h-3.5 w-3.5" />
                Edit
              </Button>
            </Link>
          )}
          <Link href={`/dashboard/planning/ppmp/${ppmp.id}/versions`}>
            <Button size="sm" variant="ghost">
              <HistoryIcon className="mr-1.5 h-3.5 w-3.5" />
              History
            </Button>
          </Link>
          <Link href="/dashboard/planning/ppmp">
            <Button size="sm" variant="ghost">Back</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main — items */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Procurement Items</CardTitle>
            </CardHeader>
            <CardContent>
              <PpmpItemTable items={items as PpmpItemWithAllocation[]} editable={false} />
            </CardContent>
          </Card>

          {/* Review actions — always render, component handles role visibility */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Review Actions</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </div>

        {/* Sidebar — approval chain */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Approval Chain</CardTitle>
            </CardHeader>
            <CardContent>
              <PpmpApprovalChain ppmp={ppmp} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
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
                <span className="text-muted-foreground">Items</span>
                <span className="font-medium">{items.length}</span>
              </div>
              {version && (
                <>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <AmountDisplay amount={version.total_estimated_cost} className="font-semibold" />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
