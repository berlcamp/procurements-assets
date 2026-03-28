import { Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"

const dashboardNav = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Planning", href: "/dashboard/planning" },
  { label: "Budget", href: "/dashboard/budget" },
  { label: "Procurement", href: "/dashboard/procurement" },
  { label: "Assets", href: "/dashboard/assets" },
  { label: "Requests", href: "/dashboard/requests" },
  { label: "Reports", href: "/dashboard/reports" },
]

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        navItems={dashboardNav}
        header={
          <span className="text-sm font-semibold">Division Portal</span>
        }
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
