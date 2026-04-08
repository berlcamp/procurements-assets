import { SidebarProvider, Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"
import { ActionCountsProvider } from "@/components/layout/action-counts-provider"
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
} from "lucide-react"
import type { NavGroup } from "@/components/layout/sidebar"

const navGroups: NavGroup[] = [
  {
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: <LayoutDashboard className="h-4 w-4" />,
      },
      {
        label: "Planning",
        href: "/dashboard/planning",
        icon: <ClipboardList className="h-4 w-4" />,
      },
      {
        label: "Budget",
        href: "/dashboard/budget",
        icon: <Wallet className="h-4 w-4" />,
      },
      {
        label: "Procurement",
        href: "/dashboard/procurement",
        icon: <ShoppingCart className="h-4 w-4" />,
      },
      {
        label: "Purchase Requests",
        href: "/dashboard/procurement/purchase-requests",
        icon: <FileText className="h-4 w-4" />,
      },
      {
        label: "Suppliers",
        href: "/dashboard/procurement/suppliers",
        icon: <Building2 className="h-4 w-4" />,
      },
      {
        label: "Activities",
        href: "/dashboard/procurement/activities",
        icon: <Gavel className="h-4 w-4" />,
      },
      {
        label: "Assets",
        href: "/dashboard/assets",
        icon: <Package className="h-4 w-4" />,
      },
      {
        label: "Requests",
        href: "/dashboard/requests",
        icon: <Inbox className="h-4 w-4" />,
      },
      {
        label: "Reports",
        href: "/dashboard/reports",
        icon: <BarChart2 className="h-4 w-4" />,
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
      },
      {
        label: "Offices",
        href: "/dashboard/admin/offices",
        icon: <Building2 className="h-4 w-4" />,
      },
      {
        label: "Roles",
        href: "/dashboard/admin/roles",
        icon: <ShieldCheck className="h-4 w-4" />,
      },
      {
        label: "Fiscal Years",
        href: "/dashboard/admin/fiscal-years",
        icon: <CalendarDays className="h-4 w-4" />,
      },
      {
        label: "Settings",
        href: "/dashboard/admin/settings",
        icon: <Settings className="h-4 w-4" />,
      },
      {
        label: "Audit Logs",
        href: "/dashboard/admin/audit-logs",
        icon: <ScrollText className="h-4 w-4" />,
      },
    ],
  },
]

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider navGroups={navGroups} sectionTitle="Division Portal">
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
