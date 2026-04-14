"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createPpmp, addPpmpProject, addPpmpLot, addPpmpLotItem } from "@/lib/actions/ppmp"
import type { PpmpLotInput } from "@/lib/schemas/ppmp"
import { revalidatePath } from "next/cache"

// ============================================================
// PPMP Bulk Import
// ============================================================

export interface PpmpImportRow {
  /** Project / general description (grouped) */
  project_description: string
  /** Project type: goods | infrastructure | consulting_services */
  project_type: "goods" | "infrastructure" | "consulting_services"
  /** Lot title (optional) */
  lot_title?: string
  /** Procurement mode e.g. svp, shopping, competitive_bidding */
  procurement_mode: string
  /** Estimated lot budget (sum of items) */
  estimated_budget: string
  /** Source of funds */
  source_of_funds?: string
  /** Procurement start YYYY-MM-DD */
  procurement_start?: string
  /** Procurement end YYYY-MM-DD */
  procurement_end?: string
  /** Item description */
  item_description: string
  /** Unit of measure */
  unit: string
  /** Quantity */
  quantity: string
  /** Estimated unit cost */
  estimated_unit_cost: string
  /** Specification */
  specification?: string
}

export interface PpmpImportResult {
  ppmpId: string | null
  rowsImported: number
  errors: string[]
}

export async function importPpmpFromRows(
  rows: PpmpImportRow[],
  officeId: string,
  fiscalYearId: string
): Promise<PpmpImportResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ppmpId: null, rowsImported: 0, errors: ["Unauthorized"] }

  if (!rows.length) return { ppmpId: null, rowsImported: 0, errors: ["No rows to import"] }

  // Create the PPMP header
  const { id: ppmpId, error: ppmpError } = await createPpmp({ office_id: officeId, fiscal_year_id: fiscalYearId })
  if (ppmpError || !ppmpId) {
    return { ppmpId: null, rowsImported: 0, errors: [ppmpError ?? "Failed to create PPMP"] }
  }

  // Get the version ID that was created
  const { data: version } = await supabase
    .schema("procurements")
    .from("ppmp_versions")
    .select("id")
    .eq("ppmp_id", ppmpId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single()

  if (!version?.id) {
    return { ppmpId, rowsImported: 0, errors: ["Failed to fetch PPMP version"] }
  }

  const ppmpVersionId = version.id
  const errors: string[] = []
  let rowsImported = 0

  // Group rows by project + lot to build hierarchy
  type LotKey = string
  const projectMap = new Map<string, { type: string; lots: Map<LotKey, { lotData: PpmpImportRow; items: PpmpImportRow[] }> }>()

  for (const row of rows) {
    const projKey = `${row.project_description}||${row.project_type}`
    const lotKey = `${row.lot_title ?? "default"}||${row.procurement_mode}||${row.estimated_budget}`

    if (!projectMap.has(projKey)) {
      projectMap.set(projKey, { type: row.project_type, lots: new Map() })
    }
    const proj = projectMap.get(projKey)!

    if (!proj.lots.has(lotKey)) {
      proj.lots.set(lotKey, { lotData: row, items: [] })
    }
    proj.lots.get(lotKey)!.items.push(row)
  }

  // Insert projects → lots → items
  for (const [projKey, proj] of projectMap) {
    const [projectDesc] = projKey.split("||")

    const { id: projectId, error: projError } = await addPpmpProject(ppmpVersionId, ppmpId, officeId, {
      general_description: projectDesc,
      project_type: proj.type as "goods" | "infrastructure" | "consulting_services",
    })

    if (projError || !projectId) {
      errors.push(`Failed to create project "${projectDesc}": ${projError}`)
      continue
    }

    for (const [, lotEntry] of proj.lots) {
      const { lotData, items } = lotEntry

      const { id: lotId, error: lotError } = await addPpmpLot(projectId, {
        lot_title: lotData.lot_title ?? null,
        procurement_mode: lotData.procurement_mode as PpmpLotInput["procurement_mode"],
        pre_procurement_conference: false,
        is_cse: false,
        procurement_start: lotData.procurement_start ?? null,
        procurement_end: lotData.procurement_end ?? null,
        delivery_period: null,
        source_of_funds: lotData.source_of_funds ?? null,
        estimated_budget: lotData.estimated_budget,
        supporting_documents: null,
        remarks: null,
        budget_allocation_id: null,
      })

      if (lotError || !lotId) {
        errors.push(`Failed to create lot under "${projectDesc}": ${lotError}`)
        continue
      }

      for (const item of items) {
        const { error: itemError } = await addPpmpLotItem(lotId, {
          description: item.item_description,
          quantity: item.quantity,
          unit: item.unit,
          specification: item.specification ?? null,
          estimated_unit_cost: item.estimated_unit_cost,
        })

        if (itemError) {
          errors.push(`Item "${item.item_description}": ${itemError}`)
        } else {
          rowsImported++
        }
      }
    }
  }

  revalidatePath("/dashboard/planning/ppmp")
  return { ppmpId, rowsImported, errors }
}

// ============================================================
// PhilGEPS Data Preparation
// ============================================================

export interface PhilGepsEntry {
  procurement_id: string
  procurement_number: string
  title: string
  procurement_method: string
  abc_amount: string
  posting_date: string | null
  submission_deadline: string | null
  contract_amount: string | null
  awarded_supplier: string | null
  philgeps_reference: string | null
  office: string
  fiscal_year: number
}

export async function getPhilGepsData(fiscalYearId?: string): Promise<PhilGepsEntry[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  let query = supabase
    .schema("procurements")
    .from("procurement_activities")
    .select(`
      id,
      procurement_number,
      procurement_method,
      abc_amount,
      posting_date,
      submission_deadline,
      contract_amount,
      philgeps_reference,
      status,
      purchase_request:purchase_requests!purchase_request_id(
        purpose,
        office:offices!office_id(name)
      ),
      supplier:suppliers!awarded_supplier_id(name),
      fiscal_year:fiscal_years!fiscal_year_id(year)
    `)
    .is("deleted_at", null)
    .in("procurement_method", ["competitive_bidding", "shopping", "svp"])
    .order("created_at", { ascending: false })

  if (fiscalYearId) {
    query = query.eq("fiscal_year_id", fiscalYearId)
  }

  const { data, error } = await query
  if (error || !data) return []

  return data.map((row: Record<string, unknown>) => {
    const pr = (row.purchase_request as Record<string, unknown> | null)
    const office = pr?.office as Record<string, unknown> | null
    const supplier = row.supplier as Record<string, unknown> | null
    const fy = row.fiscal_year as Record<string, unknown> | null

    return {
      procurement_id: row.id as string,
      procurement_number: row.procurement_number as string,
      title: (pr?.purpose as string) ?? "—",
      procurement_method: row.procurement_method as string,
      abc_amount: row.abc_amount as string,
      posting_date: row.posting_date as string | null,
      submission_deadline: row.submission_deadline as string | null,
      contract_amount: row.contract_amount as string | null,
      awarded_supplier: (supplier?.name as string) ?? null,
      philgeps_reference: row.philgeps_reference as string | null,
      office: (office?.name as string) ?? "—",
      fiscal_year: (fy?.year as number) ?? 0,
    }
  })
}
