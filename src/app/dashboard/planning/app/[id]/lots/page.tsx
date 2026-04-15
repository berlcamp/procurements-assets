import { notFound } from "next/navigation"
import Link from "next/link"
import {
  getAppById, getCurrentAppVersion, getAppItems, getAppLots, getAppUserPermissions,
} from "@/lib/actions/app"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { PpmpIndicativeFinalBadge } from "@/components/planning/ppmp-indicative-final-badge"
import { AppLotManager } from "@/components/planning/app-lot-manager"
import { ArrowLeft } from "lucide-react"

interface Props {
  params: Promise<{ id: string }>
}

export default async function AppLotsPage({ params }: Props) {
  const { id } = await params
  const [app, version, permissions] = await Promise.all([
    getAppById(id),
    getCurrentAppVersion(id),
    getAppUserPermissions(id),
  ])
  if (!app) notFound()

  const [items, lots] = await Promise.all([
    version ? getAppItems(version.id) : Promise.resolve([]),
    version ? getAppLots(version.id) : Promise.resolve([]),
  ])

  const fy = app.fiscal_year as { year: number } | undefined

  // Build ppmpId → creator name map
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
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">BAC Lots — FY {fy?.year ?? "—"}</h1>
            <PpmpIndicativeFinalBadge value={app.indicative_final} />
          </div>
          <p className="text-base text-muted-foreground">
            Create lots and assign HOPE-approved items for procurement grouping · <StatusBadge status={app.status} />
          </p>
        </div>
        <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/planning/app/${app.id}`} />}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to APP
        </Button>
      </div>

      <AppLotManager
        appId={app.id}
        items={items}
        lots={lots}
        canManageLots={permissions.canManageLots}
        canFinalizeLot={permissions.canFinalizeLot}
        creatorsByPpmpId={creatorsByPpmpId}
      />
    </div>
  )
}
