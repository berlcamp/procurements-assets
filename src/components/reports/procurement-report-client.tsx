"use client"

import { useState, useEffect, useCallback } from "react"
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AmountDisplay } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import { FiscalYearSelector } from "@/components/shared/fiscal-year-selector"
import { ExportButton } from "@/components/shared/export-button"
import { getProcurementActivities } from "@/lib/actions/procurement-activities"
import { getProcurementActivitySummary } from "@/lib/actions/procurement-activities"
import { getProcurementDashboardStats } from "@/lib/actions/procurement"
import type { ProcurementActivityWithDetails, ProcurementSummary, ProcurementDashboardStats } from "@/types/database"

const METHOD_LABELS: Record<string, string> = {
  svp: "Small Value Procurement",
  shopping: "Shopping",
  competitive_bidding: "Competitive Bidding",
  direct_contracting: "Direct Contracting",
  repeat_order: "Repeat Order",
  emergency: "Emergency",
  negotiated: "Negotiated",
  agency_to_agency: "Agency-to-Agency",
}

const PIE_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
]

const EXPORT_COLUMNS = [
  { key: "procurement_number", header: "Procurement #" },
  { key: "procurement_method", header: "Method" },
  { key: "office_name", header: "Office" },
  { key: "abc_amount", header: "ABC Amount" },
  { key: "contract_amount", header: "Awarded Amount" },
  { key: "savings_amount", header: "Savings" },
  { key: "status", header: "Status" },
  { key: "current_stage", header: "Current Stage" },
]

export function ProcurementReportClient({
  initialFyId,
  initialActivities,
  initialSummary,
  initialPrStats,
}: {
  initialFyId: string | null
  initialActivities: ProcurementActivityWithDetails[]
  initialSummary: ProcurementSummary | null
  initialPrStats: ProcurementDashboardStats | null
}) {
  const [fyId, setFyId] = useState<string | null>(initialFyId)
  const [activities, setActivities] = useState(initialActivities)
  const [summary, setSummary] = useState(initialSummary)
  const [prStats, setPrStats] = useState(initialPrStats)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (fiscalYearId: string | null) => {
    if (!fiscalYearId) {
      setActivities([])
      setSummary(null)
      setPrStats(null)
      return
    }
    setLoading(true)
    const [a, s, p] = await Promise.all([
      getProcurementActivities(fiscalYearId),
      getProcurementActivitySummary(fiscalYearId),
      getProcurementDashboardStats(fiscalYearId),
    ])
    setActivities(a)
    setSummary(s)
    setPrStats(p)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (fyId && fyId !== initialFyId) refresh(fyId)
  }, [fyId, initialFyId, refresh])

  // Chart data: by method
  const byMethod = Object.entries(
    activities.reduce<Record<string, number>>((acc, a) => {
      const m = a.procurement_method ?? "unknown"
      acc[m] = (acc[m] ?? 0) + 1
      return acc
    }, {})
  ).map(([method, count]) => ({
    name: METHOD_LABELS[method] ?? method,
    value: count,
  }))

  // Chart data: by status
  const byStatus = [
    { name: "Active", value: summary?.active ?? 0, fill: "#3b82f6" },
    { name: "Completed", value: summary?.completed ?? 0, fill: "#10b981" },
    { name: "Failed", value: summary?.failed ?? 0, fill: "#ef4444" },
  ].filter((d) => d.value > 0)

  // Export data
  const exportData = activities.map((a) => ({
    procurement_number: a.procurement_number,
    procurement_method: METHOD_LABELS[a.procurement_method] ?? a.procurement_method,
    office_name: a.office?.name ?? "",
    abc_amount: parseFloat(a.abc_amount),
    contract_amount: a.contract_amount ? parseFloat(a.contract_amount) : "",
    savings_amount: a.savings_amount ? parseFloat(a.savings_amount) : "",
    status: a.status,
    current_stage: a.current_stage?.replace(/_/g, " ") ?? "",
  }))

  return (
    <div className="space-y-6">
      {/* Header + controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="w-48">
          <FiscalYearSelector value={fyId} onChange={setFyId} />
        </div>
        <ExportButton
          data={exportData}
          columns={EXPORT_COLUMNS}
          filename={`procurement-monitoring-${fyId ?? "all"}`}
        />
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground animate-pulse">Loading report data...</p>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total Activities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.total ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total PRs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{prStats?.total_prs ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total ABC</CardTitle>
          </CardHeader>
          <CardContent>
            <AmountDisplay amount={summary?.total_abc ?? 0} className="text-xl font-bold" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total Savings</CardTitle>
          </CardHeader>
          <CardContent>
            <AmountDisplay
              amount={summary?.total_savings ?? 0}
              className="text-xl font-bold text-emerald-600"
            />
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      {(byMethod.length > 0 || byStatus.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {byMethod.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By Procurement Method</CardTitle>
                <CardDescription>Distribution of activities by method</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={byMethod}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ name, percent }) =>
                        `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`
                      }
                      labelLine={false}
                    >
                      {byMethod.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          {byStatus.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By Status</CardTitle>
                <CardDescription>Procurement activity status breakdown</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={byStatus}>
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" name="Count">
                      {byStatus.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Activities table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Procurement Activities</CardTitle>
          <CardDescription>{activities.length} activities</CardDescription>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No procurement activities for the selected fiscal year.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Procurement #</th>
                    <th className="pb-2 pr-4 font-medium">Method</th>
                    <th className="pb-2 pr-4 font-medium">Office</th>
                    <th className="pb-2 pr-4 font-medium text-right">ABC</th>
                    <th className="pb-2 pr-4 font-medium text-right">Awarded</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{a.procurement_number}</td>
                      <td className="py-2 pr-4">{METHOD_LABELS[a.procurement_method] ?? a.procurement_method}</td>
                      <td className="py-2 pr-4">{a.office?.name ?? "—"}</td>
                      <td className="py-2 pr-4 text-right">
                        <AmountDisplay amount={a.abc_amount} />
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {a.contract_amount ? <AmountDisplay amount={a.contract_amount} /> : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
