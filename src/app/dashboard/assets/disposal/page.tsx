"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { Forbidden } from "@/components/shared/forbidden"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Eye, CheckCircle } from "lucide-react"
import {
  getAssetsForDisposal,
  getDisposedAssets,
} from "@/lib/actions/assets"
import { DisposalDialog } from "@/components/assets/disposal-dialog"
import {
  DISPOSAL_METHOD_LABELS,
  ASSET_TYPE_LABELS,
} from "@/lib/schemas/asset"
import type { AssetWithDetails } from "@/types/database"

export default function AssetDisposalPage() {
  const { canAny, loading: permsLoading } = usePermissions()

  const [forDisposal, setForDisposal] = useState<AssetWithDetails[]>([])
  const [disposed, setDisposed] = useState<AssetWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [completeAsset, setCompleteAsset] = useState<AssetWithDetails | null>(null)

  const canDispose = canAny("asset.dispose", "asset.manage")

  const loadData = useCallback(async () => {
    const [forDisp, disp] = await Promise.all([
      getAssetsForDisposal(),
      getDisposedAssets(),
    ])
    setForDisposal(forDisp)
    setDisposed(disp)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!permsLoading) loadData()
  }, [permsLoading, loadData])

  if (permsLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (!canDispose) {
    return <Forbidden message="You don't have permission to manage disposals." />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Asset Disposal</h1>
        <p className="text-muted-foreground">
          Manage disposal workflow for unserviceable assets.
        </p>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">For Disposal ({forDisposal.length})</TabsTrigger>
          <TabsTrigger value="completed">Disposed ({disposed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Pending Disposal</CardTitle>
              <CardDescription>
                Assets marked for disposal, awaiting completion.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
              ) : forDisposal.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No assets pending disposal.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Property #</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Office</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Book Value</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {forDisposal.map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell className="font-mono text-sm">{asset.property_number}</TableCell>
                        <TableCell className="text-sm">{asset.description ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {ASSET_TYPE_LABELS[asset.asset_type]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{asset.office?.name ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {DISPOSAL_METHOD_LABELS[asset.disposal_method ?? ""] ?? asset.disposal_method ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {parseFloat(asset.book_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              nativeButton={false}
                              render={<Link href={`/dashboard/assets/registry/${asset.id}`} />}
                              title="View"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setCompleteAsset(asset)}
                              title="Complete Disposal"
                            >
                              <CheckCircle className="h-4 w-4" />
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
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Disposed Assets</CardTitle>
              <CardDescription>
                Previously disposed assets.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
              ) : disposed.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No disposed assets.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Property #</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {disposed.map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell className="font-mono text-sm">{asset.property_number}</TableCell>
                        <TableCell className="text-sm">{asset.description ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {ASSET_TYPE_LABELS[asset.asset_type]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {DISPOSAL_METHOD_LABELS[asset.disposal_method ?? ""] ?? asset.disposal_method ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">{asset.disposal_date ?? "—"}</TableCell>
                        <TableCell className="text-sm">{asset.disposal_reference ?? "—"}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            nativeButton={false}
                            render={<Link href={`/dashboard/assets/registry/${asset.id}`} />}
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <DisposalDialog
        open={completeAsset !== null}
        onOpenChange={(open) => !open && setCompleteAsset(null)}
        asset={completeAsset}
        mode="complete"
        onComplete={() => {
          setCompleteAsset(null)
          loadData()
        }}
      />
    </div>
  )
}
