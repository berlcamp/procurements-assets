import { SidebarProvider, Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"
import {
  LayoutDashboard,
  Building2,
  Bell,
  ClipboardList,
  Code2,
  Wallet,
} from "lucide-react"
import type { NavGroup } from "@/components/layout/sidebar"

const navGroups: NavGroup[] = [
  {
    items: [
      {
        label: "Dashboard",
        href: "/platform",
        icon: <LayoutDashboard className="h-4 w-4" />,
      },
      {
        label: "Divisions",
        href: "/platform/divisions",
        icon: <Building2 className="h-4 w-4" />,
      },
      {
        label: "Announcements",
        href: "/platform/announcements",
        icon: <Bell className="h-4 w-4" />,
      },
    ],
  },
  {
    label: "Lookup Data",
    items: [
      {
        label: "Account Codes",
        href: "/platform/lookup-data/account-codes",
        icon: <Code2 className="h-4 w-4" />,
      },
      {
        label: "Fund Sources",
        href: "/platform/lookup-data/fund-sources",
        icon: <Wallet className="h-4 w-4" />,
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        label: "Audit Logs",
        href: "/platform/audit-logs",
        icon: <ClipboardList className="h-4 w-4" />,
      },
    ],
  },
]

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider navGroups={navGroups} sectionTitle="Platform Admin">
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
    </SidebarProvider>
  )
}
