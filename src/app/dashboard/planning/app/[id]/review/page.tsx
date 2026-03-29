import { notFound } from "next/navigation"
import Link from "next/link"
import { getAppById, getCurrentAppVersion, getAppItems } from "@/lib/actions/app"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { PpmpIndicativeFinalBadge } from "@/components/planning/ppmp-indicative-final-badge"
import { AppHopeReview } from "@/components/planning/app-hope-review"
import { ArrowLeft } from "lucide-react"

interface Props {
  params: Promise<{ id: string }>
}

export default async function AppReviewPage({ params }: Props) {
  const { id } = await params
  const [app, version] = await Promise.all([
    getAppById(id),
    getCurrentAppVersion(id),
  ])
  if (!app) notFound()

  const items = version ? await getAppItems(version.id) : []
  const fy = app.fiscal_year as { year: number } | undefined

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">HOPE Review — FY {fy?.year ?? "—"}</h1>
            <PpmpIndicativeFinalBadge value={app.indicative_final} />
          </div>
          <p className="text-base text-muted-foreground">
            Review each PPMP row: approve or add remarks · <StatusBadge status={app.status} />
          </p>
        </div>
        <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/planning/app/${app.id}`} />}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to APP
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="text-lg font-semibold">APP Items for Review</h2>
          <p className="text-sm text-muted-foreground">
            Approve items to allow BAC lot assignment. Remark items to return them for revision.
          </p>
        </div>
        <div className="p-5">
          <AppHopeReview items={items} appId={app.id} />
        </div>
      </div>
    </div>
  )
}
