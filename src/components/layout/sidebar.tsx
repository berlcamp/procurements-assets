"use client";

import { useActionCounts } from "@/components/layout/action-counts-provider";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDivision } from "@/lib/hooks/use-division";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
}

export interface NavGroup {
  /** Optional section label rendered above the group (hidden when collapsed). */
  label?: string;
  items: NavItem[];
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface SidebarContextValue {
  collapsed: boolean;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  navGroups: NavGroup[];
  sectionTitle: string;
  brandName: string;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be inside SidebarProvider");
  return ctx;
}

interface SidebarProviderProps {
  children: React.ReactNode;
  navGroups: NavGroup[];
  sectionTitle: string;
  brandName?: string;
}

export function SidebarProvider({
  children,
  navGroups,
  sectionTitle,
  brandName = "PABMS",
}: SidebarProviderProps) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }, []);

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
  );
}

// ─── Nav Link ─────────────────────────────────────────────────────────────────

const PLANNING_HREF = "/dashboard/planning";
const PR_HREF = "/dashboard/procurement/purchase-requests";
const ACTIVITIES_HREF = "/dashboard/procurement/activities";

/** Single active item: longest matching href wins (e.g. /dashboard/planning over /dashboard). */
function computeActiveNavHref(
  pathname: string,
  navGroups: NavGroup[],
): string | null {
  const hrefs = navGroups.flatMap((g) => g.items.map((i) => i.href));
  const matches = hrefs.filter(
    (href) => pathname === href || pathname.startsWith(href + "/"),
  );
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (a.length >= b.length ? a : b));
}

function NavLink({
  item,
  collapsed,
  activeHref,
}: {
  item: NavItem;
  collapsed: boolean;
  activeHref: string | null;
}) {
  const isActive = activeHref === item.href;
  const { ppmp, app, pr, procurement } = useActionCounts();
  const planningCount = ppmp + app;
  const badge =
    item.href === PLANNING_HREF && planningCount > 0
      ? planningCount
      : item.href === PR_HREF && pr > 0
        ? pr
        : item.href === ACTIVITIES_HREF && procurement > 0
          ? procurement
          : 0;

  const linkClassName = cn(
    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150",
    collapsed && "justify-center px-0 w-9 mx-auto",
    isActive
      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<Link href={item.href} className={linkClassName} />}
        >
          <span className="relative">
            {item.icon && (
              <span
                className={cn(
                  "shrink-0",
                  isActive
                    ? "text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/60",
                )}
              >
                {item.icon}
              </span>
            )}
            {badge > 0 && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-white">
                {badge > 9 ? "9+" : badge}
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={12}>
          {item.label}
          {badge > 0 ? ` (${badge})` : ""}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link href={item.href} className={linkClassName}>
      {item.icon && (
        <span
          className={cn(
            "shrink-0",
            isActive
              ? "text-sidebar-accent-foreground"
              : "text-sidebar-foreground/50",
          )}
        >
          {item.icon}
        </span>
      )}
      <span className="flex-1">{item.label}</span>
      {badge > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

// ─── Sidebar Inner (shared by desktop aside + mobile Sheet) ──────────────────

function SidebarInner({
  collapsed,
  footer,
}: {
  collapsed: boolean;
  footer?: React.ReactNode;
}) {
  const { navGroups, brandName } = useSidebar();
  const pathname = usePathname();
  const activeNavHref = useMemo(
    () => computeActiveNavHref(pathname, navGroups),
    [pathname, navGroups],
  );
  const { division } = useDivision();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Brand header */}
      <div
        className={cn(
          "shrink-0 flex items-center border-b border-sidebar-border/40",
          collapsed ? "justify-center px-0 h-14" : "px-4 py-3 min-h-14",
        )}
      >
        <Link
          href="/"
          className={cn(
            "flex items-center gap-2.5 min-w-0",
            collapsed && "justify-center",
          )}
        >
          <div className="h-7 w-7 shrink-0 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <span className="text-[11px] font-extrabold text-sidebar-primary-foreground tracking-tight">
              D
            </span>
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-sidebar-accent-foreground truncate leading-tight">
                {brandName}
              </span>
              {division?.name && (
                <span className="text-[0.65rem] text-sidebar-foreground/50 truncate leading-tight mt-0.5">
                  {division.name}
                </span>
              )}
            </div>
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
                    <NavLink
                      item={item}
                      collapsed={collapsed}
                      activeHref={activeNavHref}
                    />
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
            collapsed ? "px-2 py-3" : "px-3 py-3",
          )}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  footer?: React.ReactNode;
}

export function Sidebar({ footer }: SidebarProps) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();

  return (
    <>
      {/* Desktop — full-height collapsible aside */}
      <aside
        className={cn(
          "hidden md:flex h-screen flex-col bg-sidebar overflow-hidden shrink-0",
          "border-r border-sidebar-border/30",
          "transition-[width] duration-200 ease-in-out",
          collapsed ? "w-14" : "w-60",
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
  );
}
