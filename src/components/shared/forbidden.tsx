import Link from "next/link"
import { ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface ForbiddenProps {
  title?: string
  message?: string
  backHref?: string
  backLabel?: string
}

/**
 * Renders a 403 empty-state card. Use from a server component when the current
 * user lacks the permission required to view or act on the page, instead of
 * redirecting silently — keeps the UX clear about why access is denied.
 */
export function Forbidden({
  title = "403 — Access denied",
  message = "You don't have permission to view this page. If you think this is a mistake, contact your division administrator.",
  backHref = "/dashboard",
  backLabel = "Back to dashboard",
}: ForbiddenProps) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground max-w-sm">{message}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={backHref} />}
          >
            {backLabel}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
