import Link from "next/link"
import { getPpmps } from "@/lib/actions/ppmp"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { ChevronRightIcon } from "lucide-react"
import type { PpmpWithDetails } from "@/types/database"

export default async function PlanningPage() {
  const ppmps = await getPpmps()

  const ppmpByStatus = ppmps.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Planning Module</h1>
        <p className="text-sm text-muted-foreground">
          PPMP preparation, approval, and Annual Procurement Plan (APP) management
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* PPMP Card */}
        <Card>
          <CardHeader>
            <CardTitle>Project Procurement Management Plan (PPMP)</CardTitle>
            <CardDescription>
              Office-level procurement planning per fiscal year
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              {Object.entries(ppmpByStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between text-sm">
                  <StatusBadge status={status} />
                  <span className="font-mono font-medium">{count}</span>
                </div>
              ))}
              {ppmps.length === 0 && (
                <p className="text-sm text-muted-foreground">No PPMPs yet.</p>
              )}
            </div>
            <Link href="/dashboard/planning/ppmp">
              <Button variant="outline" size="sm" className="w-full">
                View All PPMPs <ChevronRightIcon className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* APP Card — Phase 6 */}
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle>Annual Procurement Plan (APP)</CardTitle>
            <CardDescription>
              Division-wide procurement plan auto-populated from approved PPMPs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Available after PPMPs are approved. Coming in the next release.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
