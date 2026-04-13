"use client"

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ExportButton } from "@/components/shared/export-button"
import type { BudgetUtilizationByOffice, BudgetUtilizationByFundSource } from "@/types/database"

const EXPORT_COLUMNS_OFFICE = [
  { key: "office_name", header: "Office" },
  { key: "office_code", header: "Code" },
  { key: "total_adjusted", header: "Adjusted" },
  { key: "total_obligated", header: "Obligated" },
  { key: "total_disbursed", header: "Disbursed" },
  { key: "total_available", header: "Available" },
  { key: "utilization_pct", header: "Utilization %" },
]

const EXPORT_COLUMNS_FUND = [
  { key: "fund_source_name", header: "Fund Source" },
  { key: "fund_source_code", header: "Code" },
  { key: "total_adjusted", header: "Adjusted" },
  { key: "total_obligated", header: "Obligated" },
  { key: "total_disbursed", header: "Disbursed" },
  { key: "total_available", header: "Available" },
  { key: "utilization_pct", header: "Utilization %" },
]

export function BudgetUtilizationBarChart({
  data,
}: {
  data: BudgetUtilizationByOffice[]
}) {
  if (data.length === 0) return null

  const chartData = data.map((d) => ({
    name: d.office_code || d.office_name,
    Obligated: parseFloat(d.total_obligated as unknown as string),
    Available: parseFloat(d.total_available as unknown as string),
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Budget Utilization by Office</CardTitle>
        <CardDescription>Obligated vs available budget per office</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(200, data.length * 40)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
            <XAxis type="number" tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}K`} />
            <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => `₱${Number(value).toLocaleString()}`} />
            <Legend />
            <Bar dataKey="Obligated" fill="#3b82f6" stackId="a" />
            <Bar dataKey="Available" fill="#d1d5db" stackId="a" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

export function BudgetOfficeExport({
  data,
  fiscalYear,
}: {
  data: BudgetUtilizationByOffice[]
  fiscalYear: string
}) {
  return (
    <ExportButton
      data={data.map((d) => ({
        ...d,
        total_adjusted: parseFloat(d.total_adjusted as unknown as string),
        total_obligated: parseFloat(d.total_obligated as unknown as string),
        total_disbursed: parseFloat(d.total_disbursed as unknown as string),
        total_available: parseFloat(d.total_available as unknown as string),
        utilization_pct: parseFloat(d.utilization_pct as unknown as string),
      }))}
      columns={EXPORT_COLUMNS_OFFICE}
      filename={`budget-by-office-FY${fiscalYear}`}
    />
  )
}

export function BudgetFundSourceExport({
  data,
  fiscalYear,
}: {
  data: BudgetUtilizationByFundSource[]
  fiscalYear: string
}) {
  return (
    <ExportButton
      data={data.map((d) => ({
        ...d,
        total_adjusted: parseFloat(d.total_adjusted as unknown as string),
        total_obligated: parseFloat(d.total_obligated as unknown as string),
        total_disbursed: parseFloat(d.total_disbursed as unknown as string),
        total_available: parseFloat(d.total_available as unknown as string),
        utilization_pct: parseFloat(d.utilization_pct as unknown as string),
      }))}
      columns={EXPORT_COLUMNS_FUND}
      filename={`budget-by-fund-source-FY${fiscalYear}`}
    />
  )
}
