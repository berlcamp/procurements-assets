import { ShieldCheck, FileCheck2, Package, Receipt, TrendingUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { getComplianceSummary } from "@/lib/actions/reports"
import { getActiveFiscalYear } from "@/lib/actions/budget"
import { getUserPermissions } from "@/lib/actions/roles"
import { createClient } from "@/lib/supabase/server"

function ScoreColor({ pct }: { pct: number }) {
  if (pct >= 90) return <span className="text-emerald-600">{pct.toFixed(1)}%</span>
  if (pct >= 70) return <span className="text-yellow-600">{pct.toFixed(1)}%</span>
  return <span className="text-red-600">{pct.toFixed(1)}%</span>
}

function ComplianceCard({
  icon,
  title,
  numerator,
  denominator,
  label,
}: {
  icon: React.ReactNode
  title: string
  numerator: number
  denominator: number
  label: string
}) {
  const pct = denominator > 0 ? (numerator / denominator) * 100 : 100

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-sm">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          <ScoreColor pct={pct} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {numerator} of {denominator} {label}
        </p>
        {/* Simple progress bar */}
        <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-yellow-500" : "bg-red-500"
            }`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export default async function ComplianceReportPage() {
  const permissions = await getUserPermissions()
  if (!permissions.includes("reports.all")) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        You don't have permission to view compliance reports.
      </div>
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user?.id ?? "")
    .single()

  const fiscalYear = await getActiveFiscalYear()

  if (!profile?.division_id || !fiscalYear) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="text-lg font-semibold">Compliance Summary</h1>
        <p className="text-sm text-muted-foreground">
          {!fiscalYear ? "No active fiscal year configured." : "Division not found."}
        </p>
      </div>
    )
  }

  const data = await getComplianceSummary(profile.division_id, fiscalYear.id)

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Compliance Summary Report</h1>
          <p className="text-sm text-muted-foreground">
            FY {fiscalYear.year} — Document completeness, asset accountability, and OBR certification
          </p>
        </div>
      </div>

      {!data ? (
        <p className="text-sm text-muted-foreground">Unable to load compliance data.</p>
      ) : (
        <>
          {/* Overall score */}
          <Card className="border-2">
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <CardTitle>Overall Compliance Score</CardTitle>
              </div>
              <CardDescription>
                Weighted average of document completeness, asset accountability, and OBR certification
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold">
                <ScoreColor pct={data.compliance_score_pct} />
              </div>
              <div className="mt-3 h-3 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    data.compliance_score_pct >= 90
                      ? "bg-emerald-500"
                      : data.compliance_score_pct >= 70
                      ? "bg-yellow-500"
                      : "bg-red-500"
                  }`}
                  style={{ width: `${Math.min(data.compliance_score_pct, 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Breakdown cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <ComplianceCard
              icon={<FileCheck2 className="h-4 w-4 text-blue-500" />}
              title="Document Completeness"
              numerator={data.with_complete_docs}
              denominator={data.completed_procurements}
              label="completed procurements with full documentation"
            />
            <ComplianceCard
              icon={<Package className="h-4 w-4 text-orange-500" />}
              title="Asset Accountability"
              numerator={data.assets_with_par_ics}
              denominator={data.total_assets}
              label="active assets with PAR/ICS assignment"
            />
            <ComplianceCard
              icon={<Receipt className="h-4 w-4 text-emerald-500" />}
              title="OBR Certification"
              numerator={data.obr_certified}
              denominator={data.obr_total}
              label="obligation requests certified"
            />
          </div>

          {/* Detail summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Procurement</h3>
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Total activities</dt>
                      <dd className="font-medium">{data.total_procurements}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Completed</dt>
                      <dd className="font-medium">{data.completed_procurements}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">With complete docs</dt>
                      <dd className="font-medium text-emerald-600">{data.with_complete_docs}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Missing documentation</dt>
                      <dd className="font-medium text-red-600">{data.missing_docs_count}</dd>
                    </div>
                  </dl>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Assets & Obligations</h3>
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Active assets</dt>
                      <dd className="font-medium">{data.total_assets}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">With PAR/ICS</dt>
                      <dd className="font-medium text-emerald-600">{data.assets_with_par_ics}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Without PAR/ICS</dt>
                      <dd className="font-medium text-red-600">{data.assets_without_par_ics}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">OBRs certified</dt>
                      <dd className="font-medium">{data.obr_certified} / {data.obr_total}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
