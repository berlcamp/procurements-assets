"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavItem {
  label: string
  href: string
  icon?: React.ReactNode
}

export interface NavGroup {
  /** Optional section label rendered above the group (hidden when collapsed). */
  label?: string
  items: NavItem[]
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface SidebarContextValue {
  collapsed: boolean
  toggleCollapsed: () => void
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  navGroups: NavGroup[]
  sectionTitle: string
  brandName: string
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error("useSidebar must be inside SidebarProvider")
  return ctx
}

interface SidebarProviderProps {
  children: React.ReactNode
  navGroups: NavGroup[]
  sectionTitle: string
  brandName?: string
}

export function SidebarProvider({
  children,
  navGroups,
  sectionTitle,
  brandName = "DepEd PAS",
}: SidebarProviderProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (localStorage.getItem("sidebar-collapsed") === "true") {
      setCollapsed(true)
    }
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem("sidebar-collapsed", String(next))
      return next
    })
  }, [])

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        toggleCollapsed,
        mobileOpen,
        setMobileOpen,
        navGroups,
        sectionTitle,
        brandName,
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

// ─── Nav Link ─────────────────────────────────────────────────────────────────

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname()
  const isActive = pathname === item.href || pathname.startsWith(item.href + "/")

  const linkClassName = cn(
    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150",
    collapsed && "justify-center px-0 w-9 mx-auto",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger render={<Link href={item.href} className={linkClassName} />}>
          {item.icon && (
            <span className={cn("shrink-0", isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/60")}>
              {item.icon}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={12}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Link href={item.href} className={linkClassName}>
      {item.icon && (
        <span className={cn("shrink-0", isActive ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/50")}>
          {item.icon}
        </span>
      )}
      <span>{item.label}</span>
    </Link>
  )
}

// ─── Sidebar Inner (shared by desktop aside + mobile Sheet) ──────────────────

function SidebarInner({
  collapsed,
  footer,
}: {
  collapsed: boolean
  footer?: React.ReactNode
}) {
  const { navGroups, brandName } = useSidebar()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Brand header */}
      <div
        className={cn(
          "shrink-0 flex items-center h-14 border-b border-sidebar-border/40",
          collapsed ? "justify-center px-0" : "px-4"
        )}
      >
        <Link
          href="/"
          className={cn("flex items-center gap-2.5 min-w-0", collapsed && "justify-center")}
        >
          <div className="h-7 w-7 shrink-0 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <span className="text-[11px] font-extrabold text-sidebar-primary-foreground tracking-tight">
              D
            </span>
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold text-sidebar-accent-foreground truncate">
              {brandName}
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3">
        <ul className="space-y-0.5 px-2">
          {navGroups.map((group, gi) => (
            <li key={gi}>
              {gi > 0 && (
                <div className="my-2.5 border-t border-sidebar-border/40" />
              )}
              {group.label && !collapsed && (
                <p className="mb-1 mt-0.5 px-3 text-[0.65rem] font-semibold uppercase tracking-widest text-sidebar-foreground/30 select-none">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} collapsed={collapsed} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer slot */}
      {footer && (
        <div
          className={cn(
            "shrink-0 border-t border-sidebar-border/40",
            collapsed ? "px-2 py-3" : "px-3 py-3"
          )}
        >
          {footer}
        </div>
      )}
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  footer?: React.ReactNode
}

export function Sidebar({ footer }: SidebarProps) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar()

  return (
    <>
      {/* Desktop — full-height collapsible aside */}
      <aside
        className={cn(
          "hidden md:flex h-screen flex-col bg-sidebar overflow-hidden shrink-0",
          "border-r border-sidebar-border/30",
          "transition-[width] duration-200 ease-in-out",
          collapsed ? "w-14" : "w-60"
        )}
      >
        <SidebarInner collapsed={collapsed} footer={footer} />
      </aside>

      {/* Mobile — Sheet overlay */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-60 gap-0 p-0 bg-sidebar border-sidebar-border"
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarInner collapsed={false} footer={footer} />
        </SheetContent>
      </Sheet>
    </>
  )
}
