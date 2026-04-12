import Link from "next/link"
import { notFound } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { ArrowLeft } from "lucide-react"
import { getAssetById, getAssetAssignments, getDepreciationSchedule } from "@/lib/actions/assets"
import { DepreciationSchedule } from "@/components/assets/depreciation-schedule"
import {
  ASSET_TYPE_LABELS,
  CONDITION_STATUS_LABELS,
  ASSET_STATUS_LABELS,
  DOC_TYPE_LABELS,
} from "@/lib/schemas/asset"

function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [asset, assignments, depRecords] = await Promise.all([
    getAssetById(id),
    getAssetAssignments({ asset_id: id }),
    getDepreciationSchedule(id),
  ])

  if (!asset) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/dashboard/assets/registry" />}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Registry
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono">{asset.property_number}</h1>
          <p className="text-muted-foreground">{asset.description ?? "No description"}</p>
          {asset.brand_model && (
            <p className="text-sm text-muted-foreground">{asset.brand_model}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={asset.status === "active" ? "default" : asset.status === "disposed" ? "outline" : "destructive"}>
            {ASSET_STATUS_LABELS[asset.status] ?? asset.status}
          </Badge>
          <Badge variant={asset.condition_status === "serviceable" ? "default" : "secondary"}>
            {CONDITION_STATUS_LABELS[asset.condition_status] ?? asset.condition_status}
          </Badge>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Asset Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Asset Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <Badge variant="secondary">{ASSET_TYPE_LABELS[asset.asset_type]}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Serial Number</span>
              <span className="font-mono">{asset.serial_number ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Office</span>
              <span>{asset.office?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Location</span>
              <span>{asset.location ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Custodian</span>
              <span>
                {asset.current_custodian_profile
                  ? `${asset.current_custodian_profile.first_name} ${asset.current_custodian_profile.last_name}`
                  : "Unassigned"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Acquisition Date</span>
              <span>{asset.acquisition_date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Catalog Item</span>
              <span>{asset.item_catalog?.name ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Financial Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Financial</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Acquisition Cost</span>
              <span className="font-mono font-medium">{formatCurrency(asset.acquisition_cost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Residual Value</span>
              <span className="font-mono">{formatCurrency(asset.residual_value)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Useful Life</span>
              <span>{asset.useful_life_years ? `${asset.useful_life_years} years` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Accumulated Depreciation</span>
              <span className="font-mono text-orange-600">{formatCurrency(asset.accumulated_depreciation)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 mt-2">
              <span className="font-medium">Book Value</span>
              <span className="font-mono font-bold text-lg">{formatCurrency(asset.book_value)}</span>
            </div>
            {asset.disposal_date && (
              <>
                <div className="flex justify-between pt-2 border-t">
                  <span className="text-muted-foreground">Disposal Date</span>
                  <span>{asset.disposal_date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Disposal Method</span>
                  <span>{asset.disposal_method ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Disposal Reference</span>
                  <span>{asset.disposal_reference ?? "—"}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Custody History + Depreciation */}
      <Tabs defaultValue="custody">
        <TabsList>
          <TabsTrigger value="custody">Custody History ({assignments.length})</TabsTrigger>
          <TabsTrigger value="depreciation">Depreciation ({depRecords.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="custody" className="mt-4">
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No custody assignments recorded.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Custodian</TableHead>
                  <TableHead>Office</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Returned</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-sm">{a.document_number}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{DOC_TYPE_LABELS[a.document_type]}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {a.custodian_profile
                        ? `${a.custodian_profile.first_name} ${a.custodian_profile.last_name}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{a.office?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{a.assigned_date}</TableCell>
                    <TableCell className="text-sm">{a.returned_date ?? "—"}</TableCell>
                    <TableCell>
                      {a.is_current ? (
                        <Badge variant="default">Current</Badge>
                      ) : (
                        <Badge variant="outline">Returned</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="depreciation" className="mt-4">
          <DepreciationSchedule
            records={depRecords}
            acquisitionCost={parseFloat(asset.acquisition_cost)}
            residualValue={parseFloat(asset.residual_value)}
            usefulLifeYears={asset.useful_life_years}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
