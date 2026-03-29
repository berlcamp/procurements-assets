import Link from "next/link"
import { getAnnouncements } from "@/lib/actions/announcements"
import { Button } from "@/components/ui/button"
import { AnnouncementsTable } from "./announcements-table"

export default async function AnnouncementsPage() {
  const announcements = await getAnnouncements()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Announcements</h1>
          <p className="text-muted-foreground">
            Platform-wide announcements for all divisions.
          </p>
        </div>
        <Link href="/platform/announcements/new">
          <Button>Create Announcement</Button>
        </Link>
      </div>

      <AnnouncementsTable data={announcements} />
    </div>
  )
}
