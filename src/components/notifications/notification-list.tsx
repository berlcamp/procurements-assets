"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Info, CheckCircle, AlertTriangle, XCircle, ClipboardCheck, Circle } from "lucide-react"
import { cn } from "@/lib/utils"
import { referenceHref } from "@/lib/utils/notification-routes"
import { markNotificationRead, markAllNotificationsRead } from "@/lib/actions/notifications"
import { Button } from "@/components/ui/button"
import type { Notification, NotificationType } from "@/types/database"

const TYPE_ICONS: Record<NotificationType, typeof Info> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
  approval: ClipboardCheck,
}

const TYPE_COLORS: Record<NotificationType, string> = {
  info: "text-blue-500",
  success: "text-green-500",
  warning: "text-amber-500",
  error: "text-red-500",
  approval: "text-primary",
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

type FilterType = "all" | "unread" | "read"

const FILTERS: { label: string; value: FilterType }[] = [
  { label: "All", value: "all" },
  { label: "Unread", value: "unread" },
  { label: "Read", value: "read" },
]

export function NotificationList({
  notifications,
  total,
  page,
  pageSize,
  filter,
}: {
  notifications: Notification[]
  total: number
  page: number
  pageSize: number
  filter: FilterType
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const totalPages = Math.ceil(total / pageSize)

  function setFilter(f: FilterType) {
    const params = new URLSearchParams(searchParams.toString())
    if (f === "all") params.delete("filter")
    else params.set("filter", f)
    params.delete("page")
    router.push(`/dashboard/notifications?${params.toString()}`)
  }

  function goToPage(p: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (p <= 1) params.delete("page")
    else params.set("page", String(p))
    router.push(`/dashboard/notifications?${params.toString()}`)
  }

  async function handleClick(n: Notification) {
    if (!n.is_read) {
      await markNotificationRead(n.id)
    }
    const href = referenceHref(n)
    if (href) router.push(href)
    else router.refresh()
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead()
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {/* Filter tabs + mark all read */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={handleMarkAllRead}>
          Mark all read
        </Button>
      </div>

      {/* Notification rows */}
      {notifications.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No notifications
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {notifications.map((n) => {
            const Icon = TYPE_ICONS[n.type] ?? Info
            const color = TYPE_COLORS[n.type] ?? "text-muted-foreground"

            return (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                  !n.is_read && "bg-muted/30"
                )}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", color)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn("text-sm leading-snug", !n.is_read && "font-semibold")}>
                      {n.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {relativeTime(n.created_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {n.message}
                  </p>
                </div>
                {!n.is_read && (
                  <Circle className="mt-1.5 h-2 w-2 shrink-0 fill-primary text-primary" />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
