import { Bell } from "lucide-react"
import { getNotificationsPaginated } from "@/lib/actions/notifications"
import { NotificationList } from "@/components/notifications/notification-list"

export default async function NotificationsPage(props: {
  searchParams: Promise<{ page?: string; filter?: string }>
}) {
  const searchParams = await props.searchParams
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1)
  const filter = (searchParams.filter as "all" | "unread" | "read") ?? "all"
  const pageSize = 20

  const { notifications, total } = await getNotificationsPaginated(page, pageSize, filter)

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Bell className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {total} notification{total !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <NotificationList
        notifications={notifications}
        total={total}
        page={page}
        pageSize={pageSize}
        filter={filter}
      />
    </div>
  )
}
