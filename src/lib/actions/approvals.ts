"use server"

import { getPpmpsRequiringMyAction } from "@/lib/actions/ppmp"
import { getAppsRequiringMyAction } from "@/lib/actions/app"
import { getPrsRequiringMyAction } from "@/lib/actions/procurement"
import { getProcurementsRequiringMyAction } from "@/lib/actions/procurement-activities"
import type { PpmpWithDetails, AppWithDetails, PurchaseRequestWithDetails, ProcurementActivityWithDetails } from "@/types/database"

export type ApprovalModule = "ppmp" | "app" | "pr" | "procurement"

export interface ApprovalItem {
  id: string
  module: ApprovalModule
  title: string
  description: string
  status: string
  requester?: string
  office?: string
  amount?: number
  href: string
  updatedAt: string
}

const PPMP_STATUS_LABELS: Record<string, string> = {
  revision_required: "Needs revision",
  submitted: "Awaiting chief review",
  chief_reviewed: "Awaiting budget certification",
  budget_certified: "Awaiting HOPE approval",
}

const PR_STATUS_LABELS: Record<string, string> = {
  submitted: "Awaiting budget certification",
  budget_certified: "Awaiting approval",
}

const APP_STATUS_LABELS: Record<string, string> = {
  indicative: "Awaiting HOPE review",
  under_review: "Under HOPE review",
  bac_finalization: "Awaiting BAC finalization",
  final: "Awaiting HOPE approval",
}

function normalizePpmps(items: PpmpWithDetails[]): ApprovalItem[] {
  return items.map((p) => ({
    id: p.id,
    module: "ppmp" as const,
    title: `PPMP — ${p.office?.name ?? "Unknown Office"}`,
    description: PPMP_STATUS_LABELS[p.status] ?? p.status,
    status: p.status,
    office: p.office?.name,
    href: `/dashboard/planning/ppmp/${p.id}/review`,
    updatedAt: p.updated_at,
  }))
}

function normalizeApps(items: AppWithDetails[]): ApprovalItem[] {
  return items.map((a) => ({
    id: a.id,
    module: "app" as const,
    title: `APP — FY ${a.fiscal_year?.year ?? ""}`,
    description: APP_STATUS_LABELS[a.status] ?? a.status,
    status: a.status,
    href: `/dashboard/planning/app/${a.id}/review`,
    updatedAt: a.updated_at,
  }))
}

function normalizePrs(items: PurchaseRequestWithDetails[]): ApprovalItem[] {
  return items.map((pr) => ({
    id: pr.id,
    module: "pr" as const,
    title: pr.pr_number,
    description: PR_STATUS_LABELS[pr.status] ?? pr.status,
    status: pr.status,
    requester: pr.requester
      ? `${pr.requester.first_name} ${pr.requester.last_name}`
      : undefined,
    office: pr.office?.name,
    amount: parseFloat(pr.total_estimated_cost),
    href: `/dashboard/procurement/purchase-requests/${pr.id}`,
    updatedAt: pr.updated_at,
  }))
}

function normalizeProcurements(items: ProcurementActivityWithDetails[]): ApprovalItem[] {
  return items.map((pa) => ({
    id: pa.id,
    module: "procurement" as const,
    title: pa.procurement_number,
    description: `${pa.procurement_method?.replace(/_/g, " ") ?? ""} — ${pa.current_stage?.replace(/_/g, " ") ?? ""}`,
    status: pa.current_stage,
    office: pa.office?.name,
    amount: parseFloat(pa.abc_amount),
    href: `/dashboard/procurement/activities/${pa.id}`,
    updatedAt: pa.updated_at,
  }))
}

export async function getPendingApprovals(): Promise<ApprovalItem[]> {
  const [ppmps, apps, prs, procurements] = await Promise.all([
    getPpmpsRequiringMyAction(),
    getAppsRequiringMyAction(),
    getPrsRequiringMyAction(),
    getProcurementsRequiringMyAction(),
  ])

  const items: ApprovalItem[] = [
    ...normalizePpmps(ppmps),
    ...normalizeApps(apps),
    ...normalizePrs(prs),
    ...normalizeProcurements(procurements),
  ]

  // Sort by most recently updated first
  items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return items
}
