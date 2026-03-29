"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ChevronRight,
  PanelLeft,
  Bell,
  ChevronDown,
  LogOut,
  Settings,
  User,
  Menu,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { useSidebar, type NavItem } from "./sidebar"

// ─── Breadcrumb generation ────────────────────────────────────────────────────

interface Crumb {
  label: string
  href?: string
}

function humanize(segment: string) {
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function useBreadcrumbs(): Crumb[] {
  const pathname = usePathname()
  const { navGroups, sectionTitle } = useSidebar()

  const allItems: NavItem[] = navGroups.flatMap((g) => g.items)

  const match = allItems
    .filter(
      (item) => pathname === item.href || pathname.startsWith(item.href + "/")
    )
    .sort((a, b) => b.href.length - a.href.length)[0]

  const crumbs: Crumb[] = [{ label: sectionTitle }]

  if (!match) {
    const last = pathname.split("/").filter(Boolean).pop()
    if (last) crumbs.push({ label: humanize(last) })
    return crumbs
  }

  const isExact = pathname === match.href
  if (isExact) {
    crumbs.push({ label: match.label })
  } else {
    crumbs.push({ label: match.label, href: match.href })
    const next = pathname
      .slice(match.href.length)
      .split("/")
      .filter(Boolean)[0]
    if (next) crumbs.push({ label: humanize(next) })
  }

  return crumbs
}

// ─── User Dropdown ────────────────────────────────────────────────────────────

function UserDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2 outline-none hover:bg-accent transition-colors">
        <Avatar className="h-7 w-7 shrink-0">
          <AvatarFallback className="text-[10px] font-bold bg-primary text-primary-foreground">
            JD
          </AvatarFallback>
        </Avatar>
        <span className="hidden sm:block text-sm font-medium text-foreground max-w-[120px] truncate">
          John Doe
        </span>
        <ChevronDown className="hidden sm:block h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal py-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold leading-none">John Doe</span>
              <span className="text-xs text-muted-foreground mt-1">
                admin@deped.gov.ph
              </span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <User className="mr-2.5 h-4 w-4 text-muted-foreground" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Settings className="mr-2.5 h-4 w-4 text-muted-foreground" />
            Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem className="text-destructive focus:text-destructive">
            <LogOut className="mr-2.5 h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Topbar ───────────────────────────────────────────────────────────────────
/*
 * Scoped to the content column — NOT full-width.
 * The sidebar sits alongside this, spanning full viewport height.
 * Layout structure: <Sidebar /> | <div flex-col> <Topbar /> <main />
 */

interface TopbarProps {
  /** Optional extra actions rendered before the notifications icon */
  actions?: React.ReactNode
}

export function Topbar({ actions }: TopbarProps) {
  const { toggleCollapsed, setMobileOpen } = useSidebar()
  const breadcrumbs = useBreadcrumbs()

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 z-10">
      {/* Mobile: open sidebar sheet */}
      <Button
        variant="ghost"
        size="icon"
        className="flex md:hidden h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </Button>

      {/* Desktop: collapse / expand sidebar */}
      <Button
        variant="ghost"
        size="icon"
        className="hidden md:flex h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={toggleCollapsed}
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      {/* Breadcrumbs */}
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-1 text-sm"
      >
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1
          return (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              )}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    "truncate",
                    isLast ? "font-semibold text-foreground" : "text-muted-foreground"
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </span>
          )
        })}
      </nav>

      {/* Extra actions slot */}
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}

      {/* Right side controls */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </Button>
        <UserDropdown />
      </div>
    </header>
  )
}
