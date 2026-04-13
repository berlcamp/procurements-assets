"use client"

import { useEffect, useState, useCallback } from "react"
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
import { Calculator } from "lucide-react"
import { getAssetRegistry } from "@/lib/actions/assets"
import { ExportButton } from "@/components/shared/export-button"
import { DepreciationRunDialog } from "@/components/assets/depreciation-run-dialog"
import {
  CONDITION_STATUS_LABELS,
} from "@/lib/schemas/asset"
import type { AssetWithDetails } from "@/types/database"

function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function AssetReportsPage() {
  const { can, canAny, loading: permsLoading } = usePermissions()

  const [assets, setAssets] = useState<AssetWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [depRunOpen, setDepRunOpen] = useState(false)

  const canManage = can("asset.manage")

  const loadData = useCallback(async () => {
    const data = await getAssetRegistry()
    setAssets(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!permsLoading) loadData()
  }, [permsLoading, loadData])

  if (permsLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (!canAny("asset.manage", "asset.view_own")) {
    return <Forbidden message="You don't have permission to view asset reports." />
  }

  const ppeAssets = assets.filter(a => a.asset_type === "ppe" && a.status !== "disposed")
  const seAssets = assets.filter(a => a.asset_type === "semi_expendable" && a.status !== "disposed")

  const ppeTotalCost = ppeAssets.reduce((s, a) => s + parseFloat(a.acquisition_cost), 0)
  const ppeTotalBV = ppeAssets.reduce((s, a) => s + parseFloat(a.book_value), 0)
  const seTotalCost = seAssets.reduce((s, a) => s + parseFloat(a.acquisition_cost), 0)
  const seTotalBV = seAssets.reduce((s, a) => s + parseFloat(a.book_value), 0)

  const ASSET_EXPORT_COLUMNS = [
    { key: "property_number", header: "Property #" },
    { key: "description", header: "Description" },
    { key: "serial_number", header: "Serial #" },
    { key: "office_name", header: "Office" },
    { key: "custodian", header: "Custodian" },
    { key: "condition_status", header: "Condition" },
    { key: "acquisition_cost", header: "Acquisition Cost" },
    { key: "accumulated_depreciation", header: "Accum. Depreciation" },
    { key: "book_value", header: "Book Value" },
  ]

  function toExportData(list: AssetWithDetails[]) {
    return list.map((a) => ({
      property_number: a.property_number,
      description: a.description ?? "",
      serial_number: a.serial_number ?? "",
      office_name: a.office?.name ?? "",
      custodian: a.current_custodian_profile
        ? `${a.current_custodian_profile.first_name} ${a.current_custodian_profile.last_name}`
        : "",
      condition_status: CONDITION_STATUS_LABELS[a.condition_status],
      acquisition_cost: parseFloat(a.acquisition_cost),
      accumulated_depreciation: parseFloat(a.accumulated_depreciation),
      book_value: parseFloat(a.book_value),
    }))
  }

  function renderAssetTable(list: AssetWithDetails[]) {
    if (loading) {
      return <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
    }
    if (list.length === 0) {
      return <p className="text-sm text-muted-foreground py-6 text-center">No assets found.</p>
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Property #</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Office</TableHead>
            <TableHead>Custodian</TableHead>
            <TableHead>Condition</TableHead>
            <TableHead className="text-right">Acq. Cost</TableHead>
            <TableHead className="text-right">Accum. Dep.</TableHead>
            <TableHead className="text-right">Book Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-mono text-sm">{a.property_number}</TableCell>
              <TableCell className="text-sm">
                {a.description ?? "—"}
                {a.serial_number && (
                  <span className="text-xs text-muted-foreground ml-1">SN: {a.serial_number}</span>
                )}
              </TableCell>
              <TableCell className="text-sm">{a.office?.name ?? "—"}</TableCell>
              <TableCell className="text-sm">
                {a.current_custodian_profile
                  ? `${a.current_custodian_profile.first_name} ${a.current_custodian_profile.last_name}`
                  : "—"}
              </TableCell>
              <TableCell>
                <Badge variant={a.condition_status === "serviceable" ? "default" : "secondary"}>
                  {CONDITION_STATUS_LABELS[a.condition_status]}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono text-sm">{formatCurrency(a.acquisition_cost)}</TableCell>
              <TableCell className="text-right font-mono text-sm text-orange-600">
                {formatCurrency(a.accumulated_depreciation)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm font-medium">
                {formatCurrency(a.book_value)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Asset Reports</h1>
          <p className="text-muted-foreground">
            RPCPPE and semi-expendable property reports.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setDepRunOpen(true)}>
            <Calculator className="mr-2 h-4 w-4" />
            Run Depreciation
          </Button>
        )}
      </div>

      <Tabs defaultValue="ppe">
        <TabsList>
          <TabsTrigger value="ppe">PPE ({ppeAssets.length})</TabsTrigger>
          <TabsTrigger value="se">Semi-Expendable ({seAssets.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="ppe" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Report on Physical Count of Property, Plant & Equipment</CardTitle>
                  <CardDescription>
                    {ppeAssets.length} PPE asset{ppeAssets.length !== 1 ? "s" : ""}
                    {" — "}Total Cost: {formatCurrency(ppeTotalCost)}, Book Value: {formatCurrency(ppeTotalBV)}
                  </CardDescription>
                </div>
                <ExportButton
                  data={toExportData(ppeAssets)}
                  columns={ASSET_EXPORT_COLUMNS}
                  filename="rpcppe-report"
                />
              </div>
            </CardHeader>
            <CardContent>
              {renderAssetTable(ppeAssets)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="se" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Semi-Expendable Property Report</CardTitle>
                  <CardDescription>
                    {seAssets.length} semi-expendable asset{seAssets.length !== 1 ? "s" : ""}
                    {" — "}Total Cost: {formatCurrency(seTotalCost)}, Book Value: {formatCurrency(seTotalBV)}
                  </CardDescription>
                </div>
                <ExportButton
                  data={toExportData(seAssets)}
                  columns={ASSET_EXPORT_COLUMNS}
                  filename="semi-expendable-report"
                />
              </div>
            </CardHeader>
            <CardContent>
              {renderAssetTable(seAssets)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <DepreciationRunDialog
        open={depRunOpen}
        onOpenChange={setDepRunOpen}
        onComplete={() => {
          setDepRunOpen(false)
          loadData()
        }}
      />
    </div>
  )
}
