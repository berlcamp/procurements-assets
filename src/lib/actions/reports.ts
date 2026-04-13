"use server"

import { createClient } from "@/lib/supabase/server"
import type { ExecutiveDashboardData, ComplianceSummary } from "@/types/database"

export async function getExecutiveDashboard(
  divisionId: string
): Promise<ExecutiveDashboardData | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_executive_dashboard", { p_division_id: divisionId })

  if (error) {
    console.error("getExecutiveDashboard error:", error)
    return null
  }

  return data as ExecutiveDashboardData
}

export async function getComplianceSummary(
  divisionId: string,
  fiscalYearId: string
): Promise<ComplianceSummary | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_compliance_summary", {
      p_division_id: divisionId,
      p_fiscal_year_id: fiscalYearId,
    })

  if (error) {
    console.error("getComplianceSummary error:", error)
    return null
  }

  return data as ComplianceSummary
}
