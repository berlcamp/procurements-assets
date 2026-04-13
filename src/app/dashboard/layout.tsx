import { SidebarProvider, Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"
import { ActionCountsProvider } from "@/components/layout/action-counts-provider"
import { getUserPermissions } from "@/lib/actions/roles"
import { createClient } from "@/lib/supabase/server"
import {
  LayoutDashboard,
  ClipboardList,
  Wallet,
  ShoppingCart,
  Package,
  Inbox,
  BarChart2,
  Settings,
  Users,
  Building2,
  ShieldCheck,
  CalendarDays,
  ScrollText,
  FileText,
  Gavel,
  ClipboardCheck,
  Truck,
  ListTree,
  Boxes,
  ArrowRightLeft,
  Trash2,
  FileBarChart,
} from "lucide-react"
import type { NavGroup } from "@/components/layout/sidebar"

/**
 * Master nav definition. Each item carries the permission codes that make it
 * visible. If `permissions` is undefined or empty, the item is always shown.
 * A nav item is visible when the user has AT LEAST ONE of the listed perms.
 *
 * Permission mapping rationale (codes come from 20240304_permissions_seed.sql
 * and 20260407_procurement_activity_rls.sql):
 *
 * - Planning:       any ppmp.* or app.* perm covers every planning role
 * - Budget:         budget.view_all grants read; creators/adjusters also see it
 * - Procurement:    procurement/PR/bid/po/delivery perms
 * - Assets:         asset.* + inventory.manage
 * - Requests:       request.* perms (most end-user roles)
 * - Reports:        reports.all / reports.office
 * - Administration: each item maps to its own admin perm
 */
const navGroups: NavGroup[] = [
  {
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: <LayoutDashboard className="h-4 w-4" />,
        // always visible
      },
      {
        label: "Approvals",
        href: "/dashboard/approvals",
        icon: <Inbox className="h-4 w-4" />,
        // always visible — page shows empty state for users without pending items
      },
    ],
  },
  {
    label: "Planning & Budget",
    items: [
      {
        label: "Planning",
        href: "/dashboard/planning",
        icon: <ClipboardList className="h-4 w-4" />,
        permissions: [
          "ppmp.create",
          "ppmp.edit",
          "ppmp.submit",
          "ppmp.review_chief",
          "ppmp.certify",
          "ppmp.approve",
          "ppmp.view_all",
          "app.review_rows",
          "app.finalize_lots",
          "app.approve",
        ],
      },
      {
        label: "Budget",
        href: "/dashboard/budget",
        icon: <Wallet className="h-4 w-4" />,
        permissions: [
          "budget.create",
          "budget.adjust",
          "budget.certify",
          "budget.approve_adj",
          "budget.view_all",
        ],
      },
      {
        label: "Sub-AROs",
        href: "/dashboard/budget/sub-aros",
        icon: <ScrollText className="h-4 w-4" />,
        permissions: [
          "budget.create",
          "budget.certify",
          "budget.view_all",
        ],
      },
      {
        label: "Obligations",
        href: "/dashboard/budget/obligations",
        icon: <ScrollText className="h-4 w-4" />,
        permissions: [
          "budget.certify",
          "budget.view_all",
          "budget.approve_adj",
        ],
      },
    ],
  },
  {
    label: "Procurement",
    items: [
      {
        label: "Procurement",
        href: "/dashboard/procurement",
        icon: <ShoppingCart className="h-4 w-4" />,
        permissions: [
          "pr.create",
          "pr.approve",
          "proc.create",
          "proc.manage",
          "bid.evaluate",
          "bid.award",
          "po.create",
          "po.approve",
          "delivery.inspect",
        ],
      },
      {
        label: "Purchase Requests",
        href: "/dashboard/procurement/purchase-requests",
        icon: <FileText className="h-4 w-4" />,
        permissions: ["pr.create", "pr.approve", "proc.manage"],
      },
      {
        label: "Suppliers",
        href: "/dashboard/procurement/suppliers",
        icon: <Building2 className="h-4 w-4" />,
        // No dedicated supplier.* perm is seeded; anyone involved in procurement
        // may need to browse suppliers while preparing PRs or activities.
        permissions: [
          "pr.create",
          "pr.approve",
          "proc.create",
          "proc.manage",
          "bid.evaluate",
          "bid.award",
        ],
      },
      {
        label: "Activities",
        href: "/dashboard/procurement/activities",
        icon: <Gavel className="h-4 w-4" />,
        permissions: [
          "proc.create",
          "proc.manage",
          "bid.evaluate",
          "bid.award",
          "po.create",
          "po.approve",
          "delivery.inspect",
        ],
      },
      {
        label: "Purchase Orders",
        href: "/dashboard/procurement/purchase-orders",
        icon: <ClipboardCheck className="h-4 w-4" />,
        permissions: ["po.create", "po.approve", "proc.manage"],
      },
      {
        label: "Deliveries",
        href: "/dashboard/procurement/deliveries",
        icon: <Truck className="h-4 w-4" />,
        permissions: ["delivery.inspect", "po.create", "proc.manage"],
      },
    ],
  },
  {
    label: "Inventory & Assets",
    items: [
      {
        label: "Overview",
        href: "/dashboard/assets",
        icon: <Package className="h-4 w-4" />,
        permissions: [
          "asset.manage",
          "asset.assign",
          "asset.view_own",
          "asset.dispose",
          "inventory.manage",
        ],
      },
      {
        label: "Property Registry",
        href: "/dashboard/assets/registry",
        icon: <Boxes className="h-4 w-4" />,
        permissions: ["asset.manage", "asset.view_own"],
      },
      {
        label: "Assignments",
        href: "/dashboard/assets/assignments",
        icon: <ArrowRightLeft className="h-4 w-4" />,
        permissions: ["asset.assign", "asset.manage"],
      },
      {
        label: "Disposal",
        href: "/dashboard/assets/disposal",
        icon: <Trash2 className="h-4 w-4" />,
        permissions: ["asset.dispose", "asset.manage"],
      },
      {
        label: "Asset Reports",
        href: "/dashboard/assets/reports",
        icon: <FileBarChart className="h-4 w-4" />,
        permissions: ["asset.manage", "asset.view_own"],
      },
      {
        label: "Requests",
        href: "/dashboard/requests",
        icon: <Inbox className="h-4 w-4" />,
        permissions: ["request.create", "request.approve", "request.process"],
      },
      {
        label: "Reports",
        href: "/dashboard/reports",
        icon: <BarChart2 className="h-4 w-4" />,
        permissions: ["reports.all", "reports.office"],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        label: "Users",
        href: "/dashboard/admin/users",
        icon: <Users className="h-4 w-4" />,
        permissions: ["users.manage"],
      },
      {
        label: "Offices",
        href: "/dashboard/admin/offices",
        icon: <Building2 className="h-4 w-4" />,
        permissions: ["offices.manage"],
      },
      {
        label: "Roles",
        href: "/dashboard/admin/roles",
        icon: <ShieldCheck className="h-4 w-4" />,
        permissions: ["roles.assign", "users.manage"],
      },
      {
        label: "Item Catalog",
        href: "/dashboard/admin/item-catalog",
        icon: <ListTree className="h-4 w-4" />,
        permissions: ["inventory.manage", "asset.manage"],
      },
      {
        label: "Fiscal Years",
        href: "/dashboard/admin/fiscal-years",
        icon: <CalendarDays className="h-4 w-4" />,
        permissions: ["division.settings"],
      },
      {
        label: "Settings",
        href: "/dashboard/admin/settings",
        icon: <Settings className="h-4 w-4" />,
        permissions: ["division.settings"],
      },
      {
        label: "Audit Logs",
        href: "/dashboard/admin/audit-logs",
        icon: <ScrollText className="h-4 w-4" />,
        permissions: ["division.audit_logs"],
      },
    ],
  },
]

/**
 * Filter nav items whose permission list excludes the user. A group with no
 * surviving items is dropped entirely so the sidebar doesn't show empty
 * section headers.
 */
function filterNavByPermissions(
  groups: NavGroup[],
  userPerms: Set<string>,
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!item.permissions || item.permissions.length === 0) return true
        return item.permissions.some((p) => userPerms.has(p))
      }),
    }))
    .filter((group) => group.items.length > 0)
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isSuperAdmin = user?.user_metadata?.is_super_admin === true

  // Super admin sees every nav item — they manage everything across divisions
  // and aren't bound by division-scoped permissions.
  let visibleNavGroups: NavGroup[]
  if (isSuperAdmin) {
    visibleNavGroups = navGroups
  } else {
    const permissions = await getUserPermissions()
    visibleNavGroups = filterNavByPermissions(navGroups, new Set(permissions))
  }

  return (
    <SidebarProvider navGroups={visibleNavGroups} sectionTitle="Division Portal">
      <ActionCountsProvider>
        {/*
         * Asana-style layout:
         *   Sidebar spans full viewport height (left column)
         *   Content column stacks topbar + scrollable main (right column)
         */}
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Topbar />
            <main className="flex-1 overflow-y-auto bg-background p-6">
              {children}
            </main>
          </div>
        </div>
      </ActionCountsProvider>
    </SidebarProvider>
  )
}
