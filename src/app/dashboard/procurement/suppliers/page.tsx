import Link from "next/link"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/status-badge"
import { getSuppliers, getSupplierStats } from "@/lib/actions/procurement"
import type { Supplier } from "@/types/database"

export default async function SuppliersPage() {
  const [suppliers, stats] = await Promise.all([getSuppliers(), getSupplierStats()])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Supplier Registry</h1>
          <p className="text-sm text-muted-foreground">Division supplier registry</p>
        </div>
        <Button nativeButton={false} render={<Link href="/dashboard/procurement/suppliers/new" />}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add Supplier
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-6">
          <div className="text-2xl font-bold">{stats.total}</div>
          <p className="text-sm text-muted-foreground">Total Suppliers</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-2xl font-bold text-green-600">{stats.active}</div>
          <p className="text-sm text-muted-foreground">Active</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-2xl font-bold text-red-600">{stats.blacklisted}</div>
          <p className="text-sm text-muted-foreground">Blacklisted</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All Suppliers</CardTitle>
        </CardHeader>
        <CardContent>
          {suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No suppliers found. Add your first supplier.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>TIN</TableHead>
                  <TableHead>PhilGEPS No.</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s: Supplier) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="font-mono text-xs">{s.tin}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.philgeps_number ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">{s.business_type ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {s.classification.slice(0, 2).map(c => (
                          <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                        ))}
                        {s.classification.length > 2 && (
                          <Badge variant="outline" className="text-xs">
                            +{s.classification.length - 2}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/procurement/suppliers/${s.id}`} />}>
                          View
                        </Button>
                        <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/procurement/suppliers/${s.id}/edit`} />}>
                          Edit
                        </Button>
                      </div>
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
