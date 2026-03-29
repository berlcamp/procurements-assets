import Link from "next/link"
import { getPpmps } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { PlusIcon } from "lucide-react"
import type { PpmpWithDetails } from "@/types/database"
import { PPMP_VERSION_TYPE_LABELS } from "@/lib/schemas/ppmp"

export default async function PpmpListPage() {
  const ppmps = await getPpmps()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">PPMP</h1>
          <p className="text-sm text-muted-foreground">
            Project Procurement Management Plans
          </p>
        </div>
        <Link href="/dashboard/planning/ppmp/new">
          <Button>
            <PlusIcon className="mr-1.5 h-4 w-4" />
            New PPMP
          </Button>
        </Link>
      </div>

      {ppmps.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm">No PPMPs yet.</p>
          <Link href="/dashboard/planning/ppmp/new" className="mt-3 block">
            <Button variant="outline" size="sm">Create your first PPMP</Button>
          </Link>
        </div>
      ) : (
        <div className="rounded-md border">
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
                      <span className="font-mono text-xs">v{ppmp.current_version}</span>
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
                      <Link href={`/dashboard/planning/ppmp/${ppmp.id}`}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
