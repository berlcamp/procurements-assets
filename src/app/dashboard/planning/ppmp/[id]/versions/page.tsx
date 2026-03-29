import { notFound } from "next/navigation"
import Link from "next/link"
import { getPpmpById, getPpmpVersionHistory } from "@/lib/actions/ppmp"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { PpmpIndicativeFinalBadge } from "@/components/planning/ppmp-indicative-final-badge"
import { PpmpVersionDiff } from "@/components/planning/ppmp-version-diff"
import { PPMP_VERSION_TYPE_LABELS } from "@/lib/schemas/ppmp"

interface Props {
  params: Promise<{ id: string }>
}

export default async function PpmpVersionsPage({ params }: Props) {
  const { id } = await params
  const [ppmp, history] = await Promise.all([
    getPpmpById(id),
    getPpmpVersionHistory(id),
  ])
  if (!ppmp) notFound()

  const office = ppmp.office as { name: string } | undefined

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Version History</h1>
          <p className="text-sm text-muted-foreground">{office?.name}</p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/dashboard/planning/ppmp/${id}`} />}>
          Back to PPMP
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>INDICATIVE / FINAL</TableHead>
              <TableHead className="text-right">Total Budget</TableHead>
              <TableHead className="text-right">Projects</TableHead>
              <TableHead>Approved</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground text-sm">
                  No version history available.
                </TableCell>
              </TableRow>
            )}
            {history.map((v) => (
              <TableRow key={v.version_number}>
                <TableCell className="font-mono font-semibold">v{v.version_number}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">
                    {PPMP_VERSION_TYPE_LABELS[v.version_type] ?? v.version_type}
                  </Badge>
                </TableCell>
                <TableCell><StatusBadge status={v.status} /></TableCell>
                <TableCell><PpmpIndicativeFinalBadge value={v.indicative_final} /></TableCell>
                <TableCell className="text-right">
                  <AmountDisplay amount={v.total_estimated_budget} />
                </TableCell>
                <TableCell className="text-right font-mono">{v.project_count}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {v.approved_at ? new Date(v.approved_at).toLocaleDateString("en-PH") : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(v.created_at).toLocaleDateString("en-PH")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {history.length >= 2 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Version Comparison</h2>
          <PpmpVersionDiff ppmpId={id} versions={history} />
        </div>
      )}
    </div>
  )
}
