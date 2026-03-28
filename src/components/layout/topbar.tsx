"use client"

interface TopbarProps {
  title?: string
  actions?: React.ReactNode
}

export function Topbar({ title, actions }: TopbarProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      {title && (
        <span className="text-sm font-semibold text-muted-foreground">{title}</span>
      )}
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
