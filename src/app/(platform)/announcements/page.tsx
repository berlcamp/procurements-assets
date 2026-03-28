import Link from "next/link"
import { getAnnouncements } from "@/lib/actions/announcements"
import { DataTable } from "@/components/shared/data-table"
import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import type { Announcement } from "@/types/database"
import type { Column } from "@/components/shared/data-table"

export default async function AnnouncementsPage() {
  const announcements = await getAnnouncements()

  function formatDate(iso: string | null): string {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("en-PH", { dateStyle: "medium" })
  }

  const columns: Column<Announcement>[] = [
    {
      key: "title",
      header: "Title",
      render: (row) => (
        <span className="font-medium">{row.title}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => <StatusBadge status={row.type} />,
    },
    {
      key: "published_at",
      header: "Published At",
      render: (row) => formatDate(row.published_at),
    },
    {
      key: "expires_at",
      header: "Expires At",
      render: (row) => formatDate(row.expires_at),
    },
    {
      key: "is_active",
      header: "Active",
      render: (row) => (
        <StatusBadge status={row.is_active ? "active" : "suspended"} />
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Announcements</h1>
          <p className="text-muted-foreground">
            Platform-wide announcements for all divisions.
          </p>
        </div>
        <Button asChild>
          <Link href="/platform/announcements/new">Create Announcement</Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={announcements as unknown as Record<string, unknown>[]}
        searchable
        searchPlaceholder="Search by title..."
        emptyMessage="No announcements found."
      />
    </div>
  )
}
