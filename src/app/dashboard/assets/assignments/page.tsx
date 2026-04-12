"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { Forbidden } from "@/components/shared/forbidden"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Search, Eye } from "lucide-react"
import { getAssetAssignments } from "@/lib/actions/assets"
import { DOC_TYPE_LABELS, ASSET_TYPE_LABELS } from "@/lib/schemas/asset"
import type { AssetAssignmentWithDetails } from "@/types/database"

export default function AssetAssignmentsPage() {
  const { canAny, loading: permsLoading } = usePermissions()

  const [assignments, setAssignments] = useState<AssetAssignmentWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  const loadData = useCallback(async () => {
    const data = await getAssetAssignments({ is_current: true })
    setAssignments(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!permsLoading) loadData()
  }, [permsLoading, loadData])

  if (permsLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (!canAny("asset.manage", "asset.assign", "asset.view_own")) {
    return <Forbidden message="You don't have permission to view assignments." />
  }

  const filtered = assignments.filter((a) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      a.document_number.toLowerCase().includes(q) ||
      a.asset?.property_number?.toLowerCase().includes(q) ||
      a.asset?.description?.toLowerCase().includes(q) ||
      a.custodian_profile?.first_name?.toLowerCase().includes(q) ||
      a.custodian_profile?.last_name?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Asset Assignments</h1>
        <p className="text-muted-foreground">
          Current PAR and ICS custody assignments.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Assignments</CardTitle>
          <CardDescription>
            {assignments.length} active assignment{assignments.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search document #, asset, custodian..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {assignments.length === 0
                ? "No active assignments. Assign custodians when registering or transferring assets."
                : "No assignments match your search."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Custodian</TableHead>
                  <TableHead>Office</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">{a.document_number}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{DOC_TYPE_LABELS[a.document_type]}</Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <span className="font-mono text-sm">{a.asset?.property_number ?? "—"}</span>
                        {a.asset?.description && (
                          <p className="text-xs text-muted-foreground">{a.asset.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.custodian_profile
                        ? `${a.custodian_profile.first_name} ${a.custodian_profile.last_name}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{a.office?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{a.assigned_date}</TableCell>
                    <TableCell>
                      {a.asset?.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          nativeButton={false}
                          render={<Link href={`/dashboard/assets/registry/${a.asset.id}`} />}
                          title="View Asset"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
