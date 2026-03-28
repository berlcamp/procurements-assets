"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

export interface NavItem {
  label: string
  href: string
  icon?: React.ReactNode
}

interface SidebarProps {
  navItems: NavItem[]
  header?: React.ReactNode
  footer?: React.ReactNode
}

export function Sidebar({ navItems, header, footer }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-background">
      {header && (
        <div className="border-b px-4 py-4">{header}</div>
      )}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  pathname === item.href || pathname.startsWith(item.href + "/")
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {footer && (
        <div className="border-t px-4 py-4">{footer}</div>
      )}
    </aside>
  )
}
