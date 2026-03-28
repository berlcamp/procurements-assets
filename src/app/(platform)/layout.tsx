import { Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"
import {
  LayoutDashboard,
  Building2,
  Bell,
  ClipboardList,
  Code2,
  Wallet,
} from "lucide-react"

const platformNav = [
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
    label: "Account Codes",
    href: "/platform/lookup-data/account-codes",
    icon: <Code2 className="h-4 w-4" />,
  },
  {
    label: "Fund Sources",
    href: "/platform/lookup-data/fund-sources",
    icon: <Wallet className="h-4 w-4" />,
  },
  {
    label: "Announcements",
    href: "/platform/announcements",
    icon: <Bell className="h-4 w-4" />,
  },
  {
    label: "Audit Logs",
    href: "/platform/audit-logs",
    icon: <ClipboardList className="h-4 w-4" />,
  },
]

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        navItems={platformNav}
        header={
          <div className="space-y-0.5">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              DepEd PAS
            </p>
            <p className="text-sm font-bold">Super Admin</p>
          </div>
        }
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar title="Platform Administration" />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
