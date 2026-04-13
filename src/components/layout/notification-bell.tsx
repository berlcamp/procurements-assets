"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Bell } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/lib/hooks/use-auth"
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/actions/notifications"
import { referenceHref } from "@/lib/utils/notification-routes"
import type { Notification } from "@/types/database"

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const { user } = useAuth()
  const router = useRouter()

  const refresh = useCallback(() => {
    getNotifications().then(setNotifications)
  }, [])

  useEffect(() => {
    if (!user) return
    refresh()

    const supabase = createClient()
    const channel = supabase
      .channel("notification-bell")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "procurements",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => refresh()
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, refresh])

  const unreadCount = notifications.filter((n) => !n.is_read).length

  async function handleClick(n: Notification) {
    setOpen(false)
    if (!n.is_read) {
      await markNotificationRead(n.id)
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))
      )
    }
    const href = referenceHref(n)
    if (href) router.push(href)
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead()
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground transition-colors" aria-label="Notifications">
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0" sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-xs text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* List */}
        <div className="max-h-[360px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b last:border-0 hover:bg-primary/5 transition-colors",
                  !n.is_read && "bg-muted/40"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={cn("text-sm leading-snug", !n.is_read && "font-semibold")}>
                    {n.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground mt-0.5">
                    {relativeTime(n.created_at)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                  {n.message}
                </p>
              </button>
            ))
          )}
        </div>

        {/* View all link */}
        <div className="border-t px-4 py-2 text-center">
          <Link
            href="/dashboard/notifications"
            className="text-xs text-primary hover:underline"
            onClick={() => setOpen(false)}
          >
            View all notifications
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
