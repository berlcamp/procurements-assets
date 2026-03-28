import { Sidebar } from "@/components/layout/sidebar"
import { Topbar } from "@/components/layout/topbar"

const platformNav = [
  { label: "Dashboard", href: "/platform" },
  { label: "Divisions", href: "/platform/divisions" },
  { label: "Subscriptions", href: "/platform/subscriptions" },
  { label: "Lookup Data", href: "/platform/lookup-data" },
  { label: "Announcements", href: "/platform/announcements" },
  { label: "Audit Logs", href: "/platform/audit-logs" },
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
          <span className="text-sm font-semibold">Super Admin</span>
        }
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar title="Platform Administration" />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
