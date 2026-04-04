"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type {
  Ppmp,
  PpmpWithDetails,
  PpmpVersion,
  PpmpVersionWithProjects,
  PpmpProject,
  PpmpProjectWithLots,
  PpmpLot,
  PpmpLotWithItems,
  PpmpLotItem,
  PpmpLotWithAllocation,
  PpmpVersionHistoryRow,
} from "@/types/database"
import type {
  PpmpHeaderInput,
  PpmpProjectInput,
  PpmpLotInput,
  PpmpLotItemInput,
  PpmpAmendmentInput,
  PpmpChiefReviewInput,
  PpmpCertifyInput,
  PpmpApproveInput,
  PpmpReturnInput,
} from "@/lib/schemas/ppmp"

// ============================================================
// PPMP queries
// ============================================================

const PPMP_SELECT = `
  *,
  office:offices(id, name, code, office_type),
  fiscal_year:fiscal_years(id, year, status)
` as const

function officeNameFromJoin(
  office: { name: string } | { name: string }[] | null | undefined
): string | null {
  if (office == null) return null
  const row = Array.isArray(office) ? office[0] : office
  return row?.name ?? null
}

async function enrichPpmpsWithCreators(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ppmps: PpmpWithDetails[]
): Promise<PpmpWithDetails[]> {
  const ids = [...new Set(ppmps.map((p) => p.created_by).filter(Boolean))] as string[]
  if (ids.length === 0) return ppmps

  const { data: profiles, error } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("id, first_name, last_name, office:offices!office_id(name)")
    .in("id", ids)

  if (error) {
    console.error("enrichPpmpsWithCreators error:", error)
    return ppmps
  }

  type Row = {
    id: string
    first_name: string
    last_name: string
    office: { name: string } | { name: string }[] | null
  }
  const byId = new Map((profiles as Row[] | null)?.map((p) => [p.id, p]) ?? [])

  return ppmps.map((p) => {
    if (!p.created_by) return p
    const prof = byId.get(p.created_by)
    if (!prof) return p
    const full_name = [prof.first_name, prof.last_name].filter(Boolean).join(" ").trim() || "—"
    const office_name = officeNameFromJoin(prof.office)
    return { ...p, creator: { full_name, office_name } }
  })
}

export async function getPpmps(
  fiscalYearId?: string
): Promise<PpmpWithDetails[]> {
  const supabase = await createClient()

  let query = supabase
    .schema("procurements")
    .from("ppmps")
    .select(PPMP_SELECT)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (fiscalYearId) {
    query = query.eq("fiscal_year_id", fiscalYearId)
  }

  const { data, error } = await query
  if (error) {
    console.error("getPpmps error:", error)
    return []
  }
  return (data ?? []) as PpmpWithDetails[]
}

// user_roles has a many-to-one FK to roles, so Supabase returns role as a single object
type UserRoleRow = { role: { name: string } | null; office_id: string | null }

async function getUserRoleContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: profile }, { data: rolesData }] = await Promise.all([
    supabase.schema("procurements").from("user_profiles")
      .select("office_id")
      .eq("id", user.id)
      .single(),
    supabase.schema("procurements").from("user_roles")
      .select("role:roles(name), office_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .is("revoked_at", null),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roles = (rolesData ?? []) as any[] as UserRoleRow[]
  const roleNames = roles.map(r => r.role?.name).filter((n): n is string => !!n)

  return { user, profile, roles, roleNames }
}

/**
 * Returns PPMPs created by the current user ("My PPMP" list only).
 * Division- or office-wide PPMP views belong on a different screen or use {@link getPpmps}.
 */
export async function getMyPpmps(
  fiscalYearId?: string
): Promise<PpmpWithDetails[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  let query = supabase
    .schema("procurements")
    .from("ppmps")
    .select(PPMP_SELECT)
    .is("deleted_at", null)
    .eq("created_by", user.id)
    .order("created_at", { ascending: false })

  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId)

  const { data, error } = await query
  if (error) {
    console.error("getMyPpmps error:", error)
    return []
  }
  const rows = (data ?? []) as PpmpWithDetails[]
  return enrichPpmpsWithCreators(supabase, rows)
}

/**
 * Returns PPMPs that require the current user's action:
 * - Any user: PPMPs they created with status 'revision_required'
 * - Section Chief / School Head: PPMPs with status 'submitted' in their office
 * - Budget Officer: PPMPs with status 'chief_reviewed' in the division
 * - HOPE: PPMPs with status 'budget_certified' in the division
 */
export async function getPpmpsRequiringMyAction(
  fiscalYearId?: string
): Promise<PpmpWithDetails[]> {
  const supabase = await createClient()
  const ctx = await getUserRoleContext(supabase)
  if (!ctx) return []

  const { user, profile, roles, roleNames } = ctx

  const pending: PromiseLike<PpmpWithDetails[]>[] = []

  // All users: revision_required PPMPs they created
  {
    let q = supabase.schema("procurements").from("ppmps")
      .select(PPMP_SELECT)
      .is("deleted_at", null)
      .eq("status", "revision_required")
      .eq("created_by", user.id)
    if (fiscalYearId) q = q.eq("fiscal_year_id", fiscalYearId)
    pending.push(q.then(({ data }) => (data ?? []) as PpmpWithDetails[]))
  }

  // Section Chief / School Head: submitted PPMPs in their office
  if (roleNames.some(r => ["section_chief", "school_head"].includes(r))) {
    const chiefRole = roles.find(r => r.role?.name && ["section_chief", "school_head"].includes(r.role.name))
    const officeId = chiefRole?.office_id ?? profile?.office_id
    if (officeId) {
      let q = supabase.schema("procurements").from("ppmps")
        .select(PPMP_SELECT)
        .is("deleted_at", null)
        .eq("status", "submitted")
        .eq("office_id", officeId)
      if (fiscalYearId) q = q.eq("fiscal_year_id", fiscalYearId)
      pending.push(q.then(({ data }) => (data ?? []) as PpmpWithDetails[]))
    }
  }

  // Budget Officer: chief_reviewed PPMPs in division
  if (roleNames.includes("budget_officer")) {
    let q = supabase.schema("procurements").from("ppmps")
      .select(PPMP_SELECT)
      .is("deleted_at", null)
      .eq("status", "chief_reviewed")
    if (fiscalYearId) q = q.eq("fiscal_year_id", fiscalYearId)
    pending.push(q.then(({ data }) => (data ?? []) as PpmpWithDetails[]))
  }

  // HOPE: budget_certified PPMPs in division
  if (roleNames.includes("hope")) {
    let q = supabase.schema("procurements").from("ppmps")
      .select(PPMP_SELECT)
      .is("deleted_at", null)
      .eq("status", "budget_certified")
    if (fiscalYearId) q = q.eq("fiscal_year_id", fiscalYearId)
    pending.push(q.then(({ data }) => (data ?? []) as PpmpWithDetails[]))
  }

  const results = await Promise.all(pending)
  const seen = new Set<string>()
  const merged: PpmpWithDetails[] = []
  for (const list of results) {
    for (const ppmp of list) {
      if (!seen.has(ppmp.id)) {
        seen.add(ppmp.id)
        merged.push(ppmp)
      }
    }
  }
  merged.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  return merged
}

export async function getPpmpById(
  id: string
): Promise<PpmpWithDetails | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmps")
    .select(`
      *,
      office:offices(id, name, code, office_type),
      fiscal_year:fiscal_years(id, year, status)
    `)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) return null
  return data as PpmpWithDetails
}

export async function getCurrentPpmpVersion(
  ppmpId: string
): Promise<PpmpVersion | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_versions")
    .select("*")
    .eq("ppmp_id", ppmpId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single()

  if (error) return null
  return data as PpmpVersion
}

export async function getPpmpProjects(
  ppmpVersionId: string
): Promise<PpmpProjectWithLots[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_projects")
    .select(`
      *,
      ppmp_lots(
        *,
        ppmp_lot_items(*),
        budget_allocation:budget_allocations(
          id, original_amount, adjusted_amount, obligated_amount, disbursed_amount,
          fiscal_year_id, status, description,
          office:offices(id, name, code),
          fund_source:fund_sources(id, name, code),
          account_code:account_codes(id, name, code, expense_class),
          fiscal_year:fiscal_years(id, year, status)
        )
      )
    `)
    .eq("ppmp_version_id", ppmpVersionId)
    .is("deleted_at", null)
    .order("project_number", { ascending: true })

  if (error) {
    console.error("getPpmpProjects error:", error)
    return []
  }

  // Sort lots and items within each project
  const projects = (data ?? []) as PpmpProjectWithLots[]
  for (const project of projects) {
    if (project.ppmp_lots) {
      project.ppmp_lots.sort((a, b) => a.lot_number - b.lot_number)
      for (const lot of project.ppmp_lots) {
        if ((lot as PpmpLotWithItems).ppmp_lot_items) {
          (lot as PpmpLotWithItems).ppmp_lot_items!.sort(
            (a, b) => a.item_number - b.item_number
          )
        }
      }
    }
  }

  return projects
}

export async function getPpmpVersionById(
  versionId: string
): Promise<PpmpVersionWithProjects | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_versions")
    .select(`
      *,
      ppmp_projects(
        *,
        ppmp_lots(
          *,
          ppmp_lot_items(*)
        )
      )
    `)
    .eq("id", versionId)
    .single()

  if (error) return null

  const version = data as PpmpVersionWithProjects
  // Filter deleted projects, sort everything
  if (version.ppmp_projects) {
    version.ppmp_projects = version.ppmp_projects
      .filter((p: PpmpProject) => p.deleted_at === null)
      .sort((a: PpmpProject, b: PpmpProject) => a.project_number - b.project_number)

    for (const project of version.ppmp_projects) {
      if (project.ppmp_lots) {
        project.ppmp_lots.sort((a: PpmpLot, b: PpmpLot) => a.lot_number - b.lot_number)
        for (const lot of project.ppmp_lots) {
          if ((lot as PpmpLotWithItems).ppmp_lot_items) {
            (lot as PpmpLotWithItems).ppmp_lot_items!.sort(
              (a: PpmpLotItem, b: PpmpLotItem) => a.item_number - b.item_number
            )
          }
        }
      }
    }
  }

  return version
}

// ============================================================
// PPMP mutations
// ============================================================

export async function createPpmp(
  input: PpmpHeaderInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { id: null, error: "Unauthorized" }

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .single()

  if (!profile?.division_id) return { id: null, error: "No division assigned" }

  const { data: ppmp, error: ppmpError } = await supabase
    .schema("procurements")
    .from("ppmps")
    .insert({
      division_id: profile.division_id,
      office_id: input.office_id,
      fiscal_year_id: input.fiscal_year_id,
      current_version: 1,
      status: "draft",
      indicative_final: "indicative",
      created_by: user.id,
    })
    .select("id")
    .single()

  if (ppmpError) return { id: null, error: ppmpError.message }
  if (!ppmp?.id) return { id: null, error: "Failed to create PPMP" }

  const { error: versionError } = await supabase
    .schema("procurements")
    .from("ppmp_versions")
    .insert({
      ppmp_id: ppmp.id,
      version_number: 1,
      version_type: "original",
      total_estimated_budget: 0,
      status: "draft",
      indicative_final: "indicative",
      office_id: input.office_id,
      created_by: user.id,
    })

  if (versionError) return { id: null, error: versionError.message }

  revalidatePath("/dashboard/planning/ppmp")
  return { id: ppmp.id, error: null }
}

// ============================================================
// Project CRUD
// ============================================================

export async function addPpmpProject(
  ppmpVersionId: string,
  ppmpId: string,
  officeId: string,
  input: PpmpProjectInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { id: null, error: "Unauthorized" }

  // Get next project_number
  const { count } = await supabase
    .schema("procurements")
    .from("ppmp_projects")
    .select("id", { count: "exact", head: true })
    .eq("ppmp_version_id", ppmpVersionId)
    .is("deleted_at", null)

  const nextNumber = (count ?? 0) + 1

  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_projects")
    .insert({
      ppmp_version_id: ppmpVersionId,
      ppmp_id: ppmpId,
      project_number: nextNumber,
      general_description: input.general_description,
      project_type: input.project_type,
      office_id: officeId,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) return { id: null, error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { id: data.id, error: null }
}

export async function updatePpmpProject(
  projectId: string,
  input: PpmpProjectInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { data: project, error: fetchError } = await supabase
    .schema("procurements")
    .from("ppmp_projects")
    .select(`
      ppmp_id,
      ppmp_version_id,
      ppmp_versions!inner(status)
    `)
    .eq("id", projectId)
    .is("deleted_at", null)
    .single()

  if (fetchError || !project) return { error: "Project not found" }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ppmpVersions = (project as any).ppmp_versions
  const versionStatus = Array.isArray(ppmpVersions) ? ppmpVersions[0]?.status : ppmpVersions?.status
  if (versionStatus !== "draft") {
    return { error: "Cannot edit projects on a non-draft version" }
  }

  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_projects")
    .update({
      general_description: input.general_description,
      project_type: input.project_type,
    })
    .eq("id", projectId)

  if (error) return { error: error.message }

  const ppmpId = (project as { ppmp_id: string }).ppmp_id
  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

export async function deletePpmpProject(
  projectId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", projectId)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  return { error: null }
}

// ============================================================
// Lot CRUD
// ============================================================

export async function addPpmpLot(
  projectId: string,
  input: PpmpLotInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()

  // Get next lot_number
  const { count } = await supabase
    .schema("procurements")
    .from("ppmp_lots")
    .select("id", { count: "exact", head: true })
    .eq("ppmp_project_id", projectId)

  const nextLotNumber = (count ?? 0) + 1

  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_lots")
    .insert({
      ppmp_project_id: projectId,
      lot_number: nextLotNumber,
      lot_title: input.lot_title ?? null,
      procurement_mode: input.procurement_mode,
      pre_procurement_conference: input.pre_procurement_conference,
      procurement_start: input.procurement_start ?? null,
      procurement_end: input.procurement_end ?? null,
      delivery_period: input.delivery_period ?? null,
      source_of_funds: input.source_of_funds ?? null,
      estimated_budget: parseFloat(input.estimated_budget),
      supporting_documents: input.supporting_documents ?? null,
      remarks: input.remarks ?? null,
      budget_allocation_id: input.budget_allocation_id ?? null,
    })
    .select("id")
    .single()

  if (error) return { id: null, error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  return { id: data.id, error: null }
}

export async function updatePpmpLot(
  lotId: string,
  input: PpmpLotInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_lots")
    .update({
      lot_title: input.lot_title ?? null,
      procurement_mode: input.procurement_mode,
      pre_procurement_conference: input.pre_procurement_conference,
      procurement_start: input.procurement_start ?? null,
      procurement_end: input.procurement_end ?? null,
      delivery_period: input.delivery_period ?? null,
      source_of_funds: input.source_of_funds ?? null,
      estimated_budget: parseFloat(input.estimated_budget),
      supporting_documents: input.supporting_documents ?? null,
      remarks: input.remarks ?? null,
      budget_allocation_id: input.budget_allocation_id ?? null,
    })
    .eq("id", lotId)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  return { error: null }
}

export async function deletePpmpLot(
  lotId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  // CASCADE will delete lot_items too
  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_lots")
    .delete()
    .eq("id", lotId)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  return { error: null }
}

// ============================================================
// Lot Item CRUD
// ============================================================

export async function addPpmpLotItem(
  lotId: string,
  input: PpmpLotItemInput
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()

  const { count } = await supabase
    .schema("procurements")
    .from("ppmp_lot_items")
    .select("id", { count: "exact", head: true })
    .eq("ppmp_lot_id", lotId)

  const nextItemNumber = (count ?? 0) + 1

  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_lot_items")
    .insert({
      ppmp_lot_id: lotId,
      item_number: nextItemNumber,
      description: input.description,
      quantity: parseFloat(input.quantity),
      unit: input.unit,
      specification: input.specification ?? null,
      estimated_unit_cost: parseFloat(input.estimated_unit_cost),
    })
    .select("id")
    .single()

  if (error) return { id: null, error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  return { id: data.id, error: null }
}

export async function updatePpmpLotItem(
  itemId: string,
  input: PpmpLotItemInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_lot_items")
    .update({
      description: input.description,
      quantity: parseFloat(input.quantity),
      unit: input.unit,
      specification: input.specification ?? null,
      estimated_unit_cost: parseFloat(input.estimated_unit_cost),
    })
    .eq("id", itemId)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  return { error: null }
}

export async function deletePpmpLotItem(
  itemId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_lot_items")
    .delete()
    .eq("id", itemId)

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  return { error: null }
}

// ============================================================
// PPMP workflow actions
// ============================================================

export async function submitPpmp(
  ppmpId: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("submit_ppmp", { p_ppmp_id: ppmpId })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

export async function chiefReviewPpmp(
  ppmpId: string,
  input: PpmpChiefReviewInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("chief_review_ppmp", {
      p_ppmp_id: ppmpId,
      p_action: input.action,
      p_notes: input.notes ?? null,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

export async function certifyPpmpBudget(
  ppmpId: string,
  input: PpmpCertifyInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("certify_ppmp_budget", {
      p_ppmp_id: ppmpId,
      p_notes: input.notes ?? null,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

export async function approvePpmp(
  ppmpId: string,
  input: PpmpApproveInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("approve_ppmp", {
      p_ppmp_id: ppmpId,
      p_notes: input.notes ?? null,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

export async function returnPpmp(
  ppmpId: string,
  input: PpmpReturnInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { error } = await supabase
    .schema("procurements")
    .rpc("return_ppmp", {
      p_ppmp_id: ppmpId,
      p_step: input.step,
      p_notes: input.notes,
    })

  if (error) return { error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { error: null }
}

// ============================================================
// PPMP amendment
// ============================================================

export async function createPpmpAmendment(
  ppmpId: string,
  input: PpmpAmendmentInput
): Promise<{ versionId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("create_ppmp_amendment", {
      p_ppmp_id: ppmpId,
      p_justification: input.justification,
    })

  if (error) return { versionId: null, error: error.message }

  revalidatePath("/dashboard/planning/ppmp")
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`)
  return { versionId: data as string, error: null }
}

// ============================================================
// PPMP version history
// ============================================================

export async function getPpmpVersionHistory(
  ppmpId: string
): Promise<PpmpVersionHistoryRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_ppmp_version_history", { p_ppmp_id: ppmpId })

  if (error) {
    console.error("getPpmpVersionHistory error:", error)
    return []
  }
  return (data ?? []) as PpmpVersionHistoryRow[]
}
