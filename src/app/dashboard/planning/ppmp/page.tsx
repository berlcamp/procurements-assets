import Link from "next/link"
import { getMyPpmps, getPpmpsRequiringMyAction } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { PlusIcon } from "lucide-react"
import type { PpmpWithDetails } from "@/types/database"

function PpmpTable({ ppmps }: { ppmps: PpmpWithDetails[] }) {
  if (ppmps.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">No PPMPs found.</p>
      </div>
    )
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Office</TableHead>
            <TableHead>Fiscal Year</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>INDICATIVE / FINAL</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {ppmps.map((ppmp: PpmpWithDetails) => {
            const office = ppmp.office as { name: string; code: string } | undefined
            const fy = ppmp.fiscal_year as { year: number } | undefined
            return (
              <TableRow key={ppmp.id}>
                <TableCell className="font-medium">{office?.name ?? "—"}</TableCell>
                <TableCell>{fy?.year ?? "—"}</TableCell>
                <TableCell>
                  <span className="font-mono text-sm">v{ppmp.current_version}</span>
                </TableCell>
                <TableCell><StatusBadge status={ppmp.status} /></TableCell>
                <TableCell>
                  <Badge variant={ppmp.indicative_final === "final" ? "default" : "outline"}>
                    {ppmp.indicative_final.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(ppmp.created_at).toLocaleDateString("en-PH")}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/dashboard/planning/ppmp/${ppmp.id}`} />}>
                    View
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
export default async function PpmpListPage() {
  const [myPpmps, actionPpmps] = await Promise.all([
    getMyPpmps(),
    getPpmpsRequiringMyAction(),
  ])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">PPMP</h1>
          <p className="text-sm text-muted-foreground">
            Project Procurement Management Plans
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/dashboard/planning/ppmp/new" />}>
          <PlusIcon className="mr-1.5 h-4 w-4" />
          New PPMP
        </Button>
      </div>

      {/* PPMP That Requires My Action */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="text-lg font-semibold">PPMP That Requires My Action</h2>
          <p className="text-sm text-muted-foreground">
            PPMPs currently awaiting your review, approval, or revision
          </p>
        </div>
        <div className="p-0">
          <PpmpTable ppmps={actionPpmps} />
        </div>
      </section>

      {/* My PPMP */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="text-lg font-semibold">My PPMP</h2>
          <p className="text-sm text-muted-foreground">
            PPMPs you created or are within your visibility scope
          </p>
        </div>
        <div className="p-0">
          {myPpmps.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No PPMPs yet.</p>
              <Button variant="outline" size="sm" className="mt-3" nativeButton={false} render={<Link href="/dashboard/planning/ppmp/new" />}>
                Create your first PPMP
              </Button>
            </div>
          ) : (
            <PpmpTable ppmps={myPpmps} />
          )}
        </div>
      </section>
    </div>
  )
}
