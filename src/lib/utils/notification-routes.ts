import type { Notification } from "@/types/database"

const ROUTES_WITH_ID: Record<string, string> = {
  ppmp: "/dashboard/planning/ppmp",
  app: "/dashboard/planning/app",
  pr: "/dashboard/procurement/purchase-requests",
  purchase_request: "/dashboard/procurement/purchase-requests",
  procurement: "/dashboard/procurement/activities",
  purchase_order: "/dashboard/procurement/purchase-orders",
  budget_adjustment: "/dashboard/budget/adjustments",
  request: "/dashboard/requests",
}

const ROUTES_WITHOUT_ID: Record<string, string> = {
  delivery: "/dashboard/procurement/deliveries",
  asset: "/dashboard/assets/registry",
  depreciation: "/dashboard/assets/registry",
  join_request: "/dashboard/admin/users",
}

export function referenceHref(n: Notification): string | null {
  if (!n.reference_type) return null

  if (n.reference_id && ROUTES_WITH_ID[n.reference_type]) {
    return `${ROUTES_WITH_ID[n.reference_type]}/${n.reference_id}`
  }

  if (ROUTES_WITHOUT_ID[n.reference_type]) {
    return ROUTES_WITHOUT_ID[n.reference_type]
  }

  return null
}
