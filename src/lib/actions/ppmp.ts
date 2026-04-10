"use server";

import type {
  PpmpAmendmentInput,
  PpmpApproveInput,
  PpmpCertifyInput,
  PpmpChiefReviewInput,
  PpmpHeaderInput,
  PpmpLotInput,
  PpmpLotItemInput,
  PpmpProjectInput,
  PpmpReturnInput,
} from "@/lib/schemas/ppmp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  PpmpLot,
  PpmpLotItem,
  PpmpLotWithItems,
  PpmpProject,
  PpmpProjectWithLots,
  PpmpVersion,
  PpmpVersionHistoryRow,
  PpmpVersionWithProjects,
  PpmpWithDetails,
} from "@/types/database";
import { revalidatePath } from "next/cache";

// ============================================================
// Notification helpers
// ============================================================

type NotificationInsert = {
  title: string
  message: string
  type: "info" | "success" | "warning" | "error" | "approval"
  reference_type: string
  reference_id: string
}

async function notifyRoleInOffice(
  roleNames: string[],
  officeId: string,
  notification: NotificationInsert
) {
  const admin = createAdminClient()
  const { data: userRoles } = await admin
    .schema("procurements")
    .from("user_roles")
    .select("user_id, role:roles!inner(name)")
    .in("role.name" as string, roleNames)
    .eq("office_id", officeId)
    .eq("is_active", true)
    .is("revoked_at", null)

  if (!userRoles?.length) return

  const inserts = userRoles.map((r: { user_id: string }) => ({
    user_id: r.user_id,
    ...notification,
  }))
  await admin.schema("procurements").from("notifications").insert(inserts)
}

async function notifyRoleInDivision(
  roleNames: string[],
  divisionId: string,
  notification: NotificationInsert
) {
  const admin = createAdminClient()
  const { data: userRoles } = await admin
    .schema("procurements")
    .from("user_roles")
    .select("user_id, role:roles!inner(name)")
    .in("role.name" as string, roleNames)
    .eq("division_id", divisionId)
    .eq("is_active", true)
    .is("revoked_at", null)

  if (!userRoles?.length) return

  const inserts = userRoles.map((r: { user_id: string }) => ({
    user_id: r.user_id,
    ...notification,
  }))
  await admin.schema("procurements").from("notifications").insert(inserts)
}

async function notifyUser(userId: string, notification: NotificationInsert) {
  const admin = createAdminClient()
  await admin
    .schema("procurements")
    .from("notifications")
    .insert({ user_id: userId, ...notification })
}

async function getPpmpMeta(
  ppmpId: string
): Promise<{ officeId: string | null; divisionId: string | null; createdBy: string | null } | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("procurements")
    .from("ppmps")
    .select("office_id, division_id, created_by")
    .eq("id", ppmpId)
    .single()
  if (!data) return null
  return { officeId: data.office_id, divisionId: data.division_id, createdBy: data.created_by }
}

// ============================================================
// PPMP queries
// ============================================================

const PPMP_SELECT = `
  *,
  office:offices(id, name, code, office_type),
  fiscal_year:fiscal_years(id, year, status)
` as const;

function officeNameFromJoin(
  office: { name: string } | { name: string }[] | null | undefined,
): string | null {
  if (office == null) return null;
  const row = Array.isArray(office) ? office[0] : office;
  return row?.name ?? null;
}

async function enrichPpmpsWithCreators(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ppmps: PpmpWithDetails[],
): Promise<PpmpWithDetails[]> {
  const ids = [
    ...new Set(ppmps.map((p) => p.created_by).filter(Boolean)),
  ] as string[];
  if (ids.length === 0) return ppmps;

  const { data: profiles, error } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("id, first_name, last_name, office:offices!office_id(name)")
    .in("id", ids);

  if (error) {
    console.error("enrichPpmpsWithCreators error:", error);
    return ppmps;
  }

  type Row = {
    id: string;
    first_name: string;
    last_name: string;
    office: { name: string } | { name: string }[] | null;
  };
  const byId = new Map((profiles as Row[] | null)?.map((p) => [p.id, p]) ?? []);

  return ppmps.map((p) => {
    if (!p.created_by) return p;
    const prof = byId.get(p.created_by);
    if (!prof) return p;
    const full_name =
      [prof.first_name, prof.last_name].filter(Boolean).join(" ").trim() || "—";
    const office_name = officeNameFromJoin(prof.office);
    return { ...p, creator: { full_name, office_name } };
  });
}

export async function getPpmps(
  fiscalYearId?: string,
): Promise<PpmpWithDetails[]> {
  const supabase = await createClient();

  let query = supabase
    .schema("procurements")
    .from("ppmps")
    .select(PPMP_SELECT)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });

  if (fiscalYearId) {
    query = query.eq("fiscal_year_id", fiscalYearId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("getPpmps error:", error);
    return [];
  }
  return (data ?? []) as PpmpWithDetails[];
}

// user_roles has a many-to-one FK to roles, so Supabase returns role as a single object
type UserRoleRow = { role: { name: string } | null; office_id: string | null };

async function getUserRoleContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: rolesData }] = await Promise.all([
    supabase
      .schema("procurements")
      .from("user_profiles")
      .select("office_id")
      .eq("id", user.id)
      .single(),
    supabase
      .schema("procurements")
      .from("user_roles")
      .select("role:roles(name), office_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .is("revoked_at", null),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roles = (rolesData ?? []) as any[] as UserRoleRow[];
  const roleNames = roles
    .map((r) => r.role?.name)
    .filter((n): n is string => !!n);

  return { user, profile, roles, roleNames };
}

export async function getPpmpUserPermissions(): Promise<{
  canChiefReview: boolean;
  canCertify: boolean;
  canApprove: boolean;
  canReturn: boolean;
}> {
  const supabase = await createClient();
  const ctx = await getUserRoleContext(supabase);
  const none = { canChiefReview: false, canCertify: false, canApprove: false, canReturn: false };
  if (!ctx) return none;

  const { roleNames } = ctx;
  const canChiefReview = roleNames.some((r) => ["section_chief", "school_head", "division_admin"].includes(r));
  const canCertify = roleNames.some((r) => ["budget_officer", "division_admin"].includes(r));
  const canApprove = roleNames.some((r) => ["hope", "division_admin"].includes(r));
  const canReturn = canChiefReview || canCertify || canApprove;

  return { canChiefReview, canCertify, canApprove, canReturn };
}

/**
 * Returns all PPMPs in the current user's division.
 * Only accessible to roles with the `ppmp.view_all` permission.
 * Returns null when the user lacks the permission (caller should hide the section).
 * Auditors see every status; other roles see only non-draft PPMPs.
 */
export async function getAllDivisionPpmps(
  fiscalYearId?: string,
): Promise<PpmpWithDetails[] | null> {
  const supabase = await createClient();

  // Check permission via RPC (runs as the authenticated user, respects RLS)
  const { data: hasPermission, error: permError } = await supabase
    .schema("procurements")
    .rpc("has_permission", { p_permission_code: "ppmp.view_all" });

  if (permError) {
    console.error("getAllDivisionPpmps permission check error:", permError);
    return null;
  }
  if (!hasPermission) return null;

  // Determine if the user is an auditor (auditors see all statuses including draft)
  const ctx = await getUserRoleContext(supabase);
  const isAuditor = ctx?.roleNames.includes("auditor") ?? false;

  let query = supabase
    .schema("procurements")
    .from("ppmps")
    .select(PPMP_SELECT)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });

  if (!isAuditor) {
    query = query.neq("status", "draft");
  }
  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId);

  const { data, error } = await query;
  if (error) {
    console.error("getAllDivisionPpmps error:", error);
    return [];
  }
  const rows = (data ?? []) as PpmpWithDetails[];
  return enrichPpmpsWithCreators(supabase, rows);
}

/**
 * Returns PPMPs created by the current user ("My PPMP" list only).
 * Division- or office-wide PPMP views belong on a different screen or use {@link getPpmps}.
 */
export async function getMyPpmps(
  fiscalYearId?: string,
): Promise<PpmpWithDetails[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .schema("procurements")
    .from("ppmps")
    .select(PPMP_SELECT)
    .neq("status", "cancelled")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false });

  if (fiscalYearId) query = query.eq("fiscal_year_id", fiscalYearId);

  const { data, error } = await query;
  if (error) {
    console.error("getMyPpmps error:", error);
    return [];
  }
  const rows = (data ?? []) as PpmpWithDetails[];
  return enrichPpmpsWithCreators(supabase, rows);
}

/**
 * Returns PPMPs that require the current user's action:
 * - Any user: PPMPs they created with status 'revision_required'
 * - Section Chief / School Head: PPMPs with status 'submitted' in their office
 * - Budget Officer: PPMPs with status 'chief_reviewed' in the division
 * - HOPE: PPMPs with status 'budget_certified' in the division
 */
export async function getPpmpsRequiringMyAction(
  fiscalYearId?: string,
): Promise<PpmpWithDetails[]> {
  const supabase = await createClient();
  const ctx = await getUserRoleContext(supabase);
  if (!ctx) return [];

  const { user, profile, roles, roleNames } = ctx;

  const pending: PromiseLike<PpmpWithDetails[]>[] = [];

  // All users: revision_required PPMPs they created
  {
    let q = supabase
      .schema("procurements")
      .from("ppmps")
      .select(PPMP_SELECT)
      .eq("status", "revision_required")
      .eq("created_by", user.id);
    if (fiscalYearId) q = q.eq("fiscal_year_id", fiscalYearId);
    pending.push(q.then(({ data }) => (data ?? []) as PpmpWithDetails[]));
  }

  // Section Chief / School Head: submitted PPMPs in their office
  if (roleNames.some((r) => ["section_chief", "school_head"].includes(r))) {
    const chiefRole = roles.find(
      (r) =>
        r.role?.name && ["section_chief", "school_head"].includes(r.role.name),
    );
    const officeId = chiefRole?.office_id ?? profile?.office_id;
    if (officeId) {
      let q = supabase
        .schema("procurements")
        .from("ppmps")
        .select(PPMP_SELECT)
        .eq("status", "submitted")
        .eq("office_id", officeId);
      if (fiscalYearId) q = q.eq("fiscal_year_id", fiscalYearId);
      pending.push(q.then(({ data }) => (data ?? []) as PpmpWithDetails[]));
    }
  }

  // Budget Officer: chief_reviewed PPMPs in division
  if (roleNames.includes("budget_officer")) {
    let q = supabase
      .schema("procurements")
      .from("ppmps")
      .select(PPMP_SELECT)
      .eq("status", "chief_reviewed");
    if (fiscalYearId) q = q.eq("fiscal_year_id", fiscalYearId);
    pending.push(q.then(({ data }) => (data ?? []) as PpmpWithDetails[]));
  }

  // HOPE: budget_certified PPMPs in division
  if (roleNames.includes("hope")) {
    let q = supabase
      .schema("procurements")
      .from("ppmps")
      .select(PPMP_SELECT)
      .eq("status", "budget_certified");
    if (fiscalYearId) q = q.eq("fiscal_year_id", fiscalYearId);
    pending.push(q.then(({ data }) => (data ?? []) as PpmpWithDetails[]));
  }

  const results = await Promise.all(pending);
  const seen = new Set<string>();
  const merged: PpmpWithDetails[] = [];
  for (const list of results) {
    for (const ppmp of list) {
      if (!seen.has(ppmp.id)) {
        seen.add(ppmp.id);
        merged.push(ppmp);
      }
    }
  }
  merged.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
  return merged;
}

export async function getPpmpById(id: string): Promise<PpmpWithDetails | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmps")
    .select(
      `
      *,
      office:offices(id, name, code, office_type),
      fiscal_year:fiscal_years(id, year, status)
    `,
    )
    .eq("id", id)
    .single();

  if (error) return null;
  return data as PpmpWithDetails;
}

export async function getCurrentPpmpVersion(
  ppmpId: string,
): Promise<PpmpVersion | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_versions")
    .select("*")
    .eq("ppmp_id", ppmpId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();

  if (error) return null;
  return data as PpmpVersion;
}

export async function getPpmpProjects(
  ppmpVersionId: string,
): Promise<PpmpProjectWithLots[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_projects")
    .select(
      `
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
    `,
    )
    .eq("ppmp_version_id", ppmpVersionId)
    .order("project_number", { ascending: true });

  if (error) {
    console.error("getPpmpProjects error:", error);
    return [];
  }

  // Sort lots and items within each project
  const projects = (data ?? []) as PpmpProjectWithLots[];
  for (const project of projects) {
    if (project.ppmp_lots) {
      project.ppmp_lots.sort((a, b) => a.lot_number - b.lot_number);
      for (const lot of project.ppmp_lots) {
        if ((lot as PpmpLotWithItems).ppmp_lot_items) {
          (lot as PpmpLotWithItems).ppmp_lot_items!.sort(
            (a, b) => a.item_number - b.item_number,
          );
        }
      }
    }
  }

  return projects;
}

export async function getPpmpVersionById(
  versionId: string,
): Promise<PpmpVersionWithProjects | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("procurements")
    .from("ppmp_versions")
    .select(
      `
      *,
      ppmp_projects(
        *,
        ppmp_lots(
          *,
          ppmp_lot_items(*)
        )
      )
    `,
    )
    .eq("id", versionId)
    .single();

  if (error) return null;

  const version = data as PpmpVersionWithProjects;
  if (version.ppmp_projects) {
    version.ppmp_projects = version.ppmp_projects
      .sort(
        (a: PpmpProject, b: PpmpProject) => a.project_number - b.project_number,
      );

    for (const project of version.ppmp_projects) {
      if (project.ppmp_lots) {
        project.ppmp_lots.sort(
          (a: PpmpLot, b: PpmpLot) => a.lot_number - b.lot_number,
        );
        for (const lot of project.ppmp_lots) {
          if ((lot as PpmpLotWithItems).ppmp_lot_items) {
            (lot as PpmpLotWithItems).ppmp_lot_items!.sort(
              (a: PpmpLotItem, b: PpmpLotItem) => a.item_number - b.item_number,
            );
          }
        }
      }
    }
  }

  return version;
}

// ============================================================
// PPMP mutations
// ============================================================

/**
 * Cancels a PPMP that is still in draft status. Only the creator may cancel.
 * The record is preserved for audit purposes; the PPMP is simply marked 'cancelled'.
 */
export async function cancelPpmp(
  ppmpId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: row, error: fetchError } = await supabase
    .schema("procurements")
    .from("ppmps")
    .select("id, created_by, status")
    .eq("id", ppmpId)
    .single();

  if (fetchError || !row) return { error: "PPMP not found" };
  if (row.created_by !== user.id) return { error: "Only the PPMP owner can cancel it" };
  if (row.status !== "draft") return { error: "Only draft PPMPs can be cancelled" };

  const { error } = await supabase
    .schema("procurements")
    .from("ppmps")
    .update({ status: "cancelled" })
    .eq("id", ppmpId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/planning/ppmp");
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`);
  return { error: null };
}

export async function createPpmp(
  input: PpmpHeaderInput,
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Unauthorized" };

  const { data: profile } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .single();

  if (!profile?.division_id) return { id: null, error: "No division assigned" };

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
    .single();

  if (ppmpError) return { id: null, error: ppmpError.message };
  if (!ppmp?.id) return { id: null, error: "Failed to create PPMP" };

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
    });

  if (versionError) return { id: null, error: versionError.message };

  revalidatePath("/dashboard/planning/ppmp");
  return { id: ppmp.id, error: null };
}

// ============================================================
// Project CRUD
// ============================================================

export async function addPpmpProject(
  ppmpVersionId: string,
  ppmpId: string,
  officeId: string,
  input: PpmpProjectInput,
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, error: "Unauthorized" };

  // Get next project_number
  const { count } = await supabase
    .schema("procurements")
    .from("ppmp_projects")
    .select("id", { count: "exact", head: true })
    .eq("ppmp_version_id", ppmpVersionId);

  const nextNumber = (count ?? 0) + 1;

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
    .single();

  if (error) return { id: null, error: error.message };

  revalidatePath("/dashboard/planning/ppmp");
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`);
  return { id: data.id, error: null };
}

export async function updatePpmpProject(
  projectId: string,
  input: PpmpProjectInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: project, error: fetchError } = await supabase
    .schema("procurements")
    .from("ppmp_projects")
    .select(
      `
      ppmp_id,
      ppmp_version_id,
      ppmp_versions!inner(status)
    `,
    )
    .eq("id", projectId)
    .single();

  if (fetchError || !project) return { error: "Project not found" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ppmpVersions = (project as any).ppmp_versions;
  const versionStatus = Array.isArray(ppmpVersions)
    ? ppmpVersions[0]?.status
    : ppmpVersions?.status;
  if (versionStatus !== "draft") {
    return { error: "Cannot edit projects on a non-draft version" };
  }

  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_projects")
    .update({
      general_description: input.general_description,
      project_type: input.project_type,
    })
    .eq("id", projectId);

  if (error) return { error: error.message };

  const ppmpId = (project as { ppmp_id: string }).ppmp_id;
  revalidatePath("/dashboard/planning/ppmp");
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`);
  return { error: null };
}

export async function deletePpmpProject(
  projectId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_projects")
    .delete()
    .eq("id", projectId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/planning/ppmp");
  return { error: null };
}

// ============================================================
// Lot CRUD
// ============================================================

export async function addPpmpLot(
  projectId: string,
  input: PpmpLotInput,
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();

  // Get next lot_number
  const { count } = await supabase
    .schema("procurements")
    .from("ppmp_lots")
    .select("id", { count: "exact", head: true })
    .eq("ppmp_project_id", projectId);

  const nextLotNumber = (count ?? 0) + 1;

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
    .single();

  if (error) return { id: null, error: error.message };

  revalidatePath("/dashboard/planning/ppmp");
  return { id: data.id, error: null };
}

export async function updatePpmpLot(
  lotId: string,
  input: PpmpLotInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

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
    .eq("id", lotId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/planning/ppmp");
  return { error: null };
}

export async function deletePpmpLot(
  lotId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  // CASCADE will delete lot_items too
  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_lots")
    .delete()
    .eq("id", lotId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/planning/ppmp");
  return { error: null };
}

// ============================================================
// Lot Item CRUD
// ============================================================

export async function addPpmpLotItem(
  lotId: string,
  input: PpmpLotItemInput,
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient();

  const { count } = await supabase
    .schema("procurements")
    .from("ppmp_lot_items")
    .select("id", { count: "exact", head: true })
    .eq("ppmp_lot_id", lotId);

  const nextItemNumber = (count ?? 0) + 1;

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
    .single();

  if (error) return { id: null, error: error.message };

  revalidatePath("/dashboard/planning/ppmp");
  return { id: data.id, error: null };
}

export async function updatePpmpLotItem(
  itemId: string,
  input: PpmpLotItemInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

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
    .eq("id", itemId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/planning/ppmp");
  return { error: null };
}

export async function deletePpmpLotItem(
  itemId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .schema("procurements")
    .from("ppmp_lot_items")
    .delete()
    .eq("id", itemId);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/planning/ppmp");
  return { error: null };
}

// ============================================================
// PPMP workflow actions
// ============================================================

export async function submitPpmp(
  ppmpId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .schema("procurements")
    .rpc("submit_ppmp", { p_ppmp_id: ppmpId });

  if (error) return { error: error.message };

  const meta = await getPpmpMeta(ppmpId);
  if (meta?.officeId) {
    notifyRoleInOffice(
      ["section_chief", "school_head"],
      meta.officeId,
      {
        title: "PPMP Submitted for Review",
        message: "A PPMP from your office has been submitted and requires your review.",
        type: "approval",
        reference_type: "ppmp",
        reference_id: ppmpId,
      }
    )
  }

  revalidatePath("/dashboard/planning/ppmp");
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`);
  return { error: null };
}

export async function chiefReviewPpmp(
  ppmpId: string,
  input: PpmpChiefReviewInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .schema("procurements")
    .rpc("chief_review_ppmp", {
      p_ppmp_id: ppmpId,
      p_action: input.action,
      p_notes: input.notes ?? null,
    });

  if (error) return { error: error.message };

  const meta = await getPpmpMeta(ppmpId);
  if (meta) {
    if (input.action === "forward" && meta.divisionId) {
      notifyRoleInDivision(
        ["budget_officer"],
        meta.divisionId,
        {
          title: "PPMP Ready for Budget Certification",
          message: "A PPMP has been reviewed by the Section Chief and is awaiting budget certification.",
          type: "approval",
          reference_type: "ppmp",
          reference_id: ppmpId,
        }
      )
    } else if (input.action === "return" && meta.createdBy) {
      notifyUser(meta.createdBy, {
        title: "PPMP Returned for Revision",
        message: input.notes
          ? `Your PPMP was returned. Notes: ${input.notes}`
          : "Your PPMP was returned for revision by the Section Chief.",
        type: "warning",
        reference_type: "ppmp",
        reference_id: ppmpId,
      })
    }
  }

  revalidatePath("/dashboard/planning/ppmp");
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`);
  return { error: null };
}

export async function certifyPpmpBudget(
  ppmpId: string,
  input: PpmpCertifyInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .schema("procurements")
    .rpc("certify_ppmp_budget", {
      p_ppmp_id: ppmpId,
      p_notes: input.notes ?? null,
    });

  if (error) return { error: error.message };

  const meta = await getPpmpMeta(ppmpId);
  if (meta?.divisionId) {
    notifyRoleInDivision(
      ["hope"],
      meta.divisionId,
      {
        title: "PPMP Ready for Approval",
        message: "A PPMP has been budget-certified and is awaiting your final approval.",
        type: "approval",
        reference_type: "ppmp",
        reference_id: ppmpId,
      }
    )
  }

  revalidatePath("/dashboard/planning/ppmp");
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`);
  return { error: null };
}

export async function approvePpmp(
  ppmpId: string,
  input: PpmpApproveInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.schema("procurements").rpc("approve_ppmp", {
    p_ppmp_id: ppmpId,
    p_notes: input.notes ?? null,
  });

  if (error) return { error: error.message };

  const meta = await getPpmpMeta(ppmpId);
  if (meta?.createdBy) {
    notifyUser(meta.createdBy, {
      title: "PPMP Approved",
      message: "Your PPMP has been approved by the HOPE.",
      type: "success",
      reference_type: "ppmp",
      reference_id: ppmpId,
    })
  }

  revalidatePath("/dashboard/planning/ppmp");
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`);
  return { error: null };
}

export async function returnPpmp(
  ppmpId: string,
  input: PpmpReturnInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.schema("procurements").rpc("return_ppmp", {
    p_ppmp_id: ppmpId,
    p_step: input.step,
    p_notes: input.notes,
  });

  if (error) return { error: error.message };

  const meta = await getPpmpMeta(ppmpId);
  if (meta) {
    const notesSuffix = input.notes ? ` Notes: ${input.notes}` : ""
    if (input.step === "to_end_user" && meta.createdBy) {
      notifyUser(meta.createdBy, {
        title: "PPMP Returned for Revision",
        message: `Your PPMP was returned for revision.${notesSuffix}`,
        type: "warning",
        reference_type: "ppmp",
        reference_id: ppmpId,
      })
    } else if (input.step === "to_chief" && meta.officeId) {
      notifyRoleInOffice(
        ["section_chief", "school_head"],
        meta.officeId,
        {
          title: "PPMP Returned to Chief Review",
          message: `A PPMP has been returned to your level for re-review.${notesSuffix}`,
          type: "warning",
          reference_type: "ppmp",
          reference_id: ppmpId,
        }
      )
    } else if (input.step === "to_budget" && meta.divisionId) {
      notifyRoleInDivision(
        ["budget_officer"],
        meta.divisionId,
        {
          title: "PPMP Returned to Budget",
          message: `A PPMP has been returned for budget re-certification.${notesSuffix}`,
          type: "warning",
          reference_type: "ppmp",
          reference_id: ppmpId,
        }
      )
    }
  }

  revalidatePath("/dashboard/planning/ppmp");
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`);
  return { error: null };
}

// ============================================================
// PPMP amendment
// ============================================================

export async function createPpmpAmendment(
  ppmpId: string,
  input: PpmpAmendmentInput,
): Promise<{ versionId: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("create_ppmp_amendment", {
      p_ppmp_id: ppmpId,
      p_justification: input.justification,
    });

  if (error) return { versionId: null, error: error.message };

  revalidatePath("/dashboard/planning/ppmp");
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`);
  return { versionId: data as string, error: null };
}

// ============================================================
// PPMP version history
// ============================================================

export async function getPpmpVersionHistory(
  ppmpId: string,
): Promise<PpmpVersionHistoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("procurements")
    .rpc("get_ppmp_version_history", { p_ppmp_id: ppmpId });

  if (error) {
    console.error("getPpmpVersionHistory error:", error);
    return [];
  }
  return (data ?? []) as PpmpVersionHistoryRow[];
}

// ============================================================
// PPMP Remarks (approval_logs with action = 'noted')
// ============================================================

export type PpmpRemark = {
  id: string;
  remarks: string;
  acted_at: string;
  step_name: string;
  actor_name: string;
};

export async function getPpmpRemarks(ppmpId: string): Promise<PpmpRemark[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("procurements")
    .from("approval_logs")
    .select("id, remarks, acted_at, step_name, acted_by")
    .eq("reference_type", "ppmp")
    .eq("reference_id", ppmpId)
    .eq("action", "noted")
    .order("acted_at", { ascending: true });

  if (error) {
    console.error("getPpmpRemarks error:", error);
    return [];
  }

  const rows = (data ?? []) as {
    id: string;
    remarks: string;
    acted_at: string;
    step_name: string;
    acted_by: string;
  }[];

  if (rows.length === 0) return [];

  // Resolve actor names
  const actorIds = [...new Set(rows.map((r) => r.acted_by))];
  const { data: profiles } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("id, first_name, last_name")
    .in("id", actorIds);

  const nameMap = new Map(
    (profiles ?? []).map((p: { id: string; first_name: string; last_name: string }) => [
      p.id,
      `${p.first_name} ${p.last_name}`.trim(),
    ]),
  );

  return rows.map((r) => ({
    id: r.id,
    remarks: r.remarks,
    acted_at: r.acted_at,
    step_name: r.step_name,
    actor_name: nameMap.get(r.acted_by) ?? "Unknown",
  }));
}

export async function addPpmpRemark(
  ppmpId: string,
  remarks: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .schema("procurements")
    .rpc("add_ppmp_remark", { p_ppmp_id: ppmpId, p_remarks: remarks });

  if (error) {
    console.error("addPpmpRemark error:", error);
    return { error: error.message };
  }
  revalidatePath(`/dashboard/planning/ppmp/${ppmpId}`);
  return { error: null };
}
