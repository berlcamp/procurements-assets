import { ShoppingCart } from "lucide-react"
import { getActiveFiscalYear } from "@/lib/actions/budget"
import { getProcurementActivities, getProcurementActivitySummary } from "@/lib/actions/procurement-activities"
import { getProcurementDashboardStats } from "@/lib/actions/procurement"
import { ProcurementReportClient } from "@/components/reports/procurement-report-client"

export default async function ProcurementReportPage() {
  const fiscalYear = await getActiveFiscalYear()

  const [activities, summary, prStats] = await Promise.all([
    fiscalYear ? getProcurementActivities(fiscalYear.id) : Promise.resolve([]),
    fiscalYear ? getProcurementActivitySummary(fiscalYear.id) : Promise.resolve(null),
    fiscalYear ? getProcurementDashboardStats(fiscalYear.id) : Promise.resolve(null),
  ])

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <ShoppingCart className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Procurement Monitoring Report</h1>
          <p className="text-sm text-muted-foreground">
            Activities, methods, and savings analysis
          </p>
        </div>
      </div>

      <ProcurementReportClient
        initialFyId={fiscalYear?.id ?? null}
        initialActivities={activities}
        initialSummary={summary}
        initialPrStats={prStats}
      />
    </div>
  )
}
