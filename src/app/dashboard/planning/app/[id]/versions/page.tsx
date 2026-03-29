import { notFound } from "next/navigation"
import Link from "next/link"
import { getAppById, getAppVersionHistory } from "@/lib/actions/app"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { ArrowLeft } from "lucide-react"

interface Props {
  params: Promise<{ id: string }>
}

export default async function AppVersionsPage({ params }: Props) {
  const { id } = await params
  const app = await getAppById(id)
  if (!app) notFound()

  const versions = await getAppVersionHistory(id)
  const fy = app.fiscal_year as { year: number } | undefined

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Version History — FY {fy?.year ?? "—"}</h1>
          <p className="text-sm text-muted-foreground">
            All APP versions including amendments and supplementals
          </p>
        </div>
        <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/planning/app/${app.id}`} />}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to APP
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        {versions.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">No versions found.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>INDICATIVE / FINAL</TableHead>
                <TableHead className="text-right">Total Est. Cost</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <span className="font-mono text-sm font-medium">v{v.version_number}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">
                      {v.version_type}
                    </Badge>
                  </TableCell>
                  <TableCell><StatusBadge status={v.status} /></TableCell>
                  <TableCell>
                    <Badge variant={v.indicative_final === "final" ? "default" : "outline"}>
                      {v.indicative_final.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <AmountDisplay amount={v.total_estimated_cost} className="text-sm" />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {v.approved_at
                      ? new Date(v.approved_at).toLocaleDateString("en-PH")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(v.created_at).toLocaleDateString("en-PH")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
