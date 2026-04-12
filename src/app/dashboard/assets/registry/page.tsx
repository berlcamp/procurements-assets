"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { useOffice } from "@/lib/hooks/use-office"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Search, Plus, Eye, ArrowRightLeft, Wrench } from "lucide-react"
import {
  getAssetRegistry,
  getDeliveryItemsForRegistration,
  getDivisionUsers,
} from "@/lib/actions/assets"
import { getItemCatalog } from "@/lib/actions/inventory"
import { getOffices } from "@/lib/actions/offices"
import { AssetRegisterDialog } from "@/components/assets/asset-register-dialog"
import { TransferAssetDialog } from "@/components/assets/transfer-asset-dialog"
import { UpdateConditionDialog } from "@/components/assets/update-condition-dialog"
import {
  ASSET_TYPE_LABELS,
  CONDITION_STATUS_LABELS,
  ASSET_STATUS_LABELS,
} from "@/lib/schemas/asset"
import type { AssetWithDetails, ItemCatalogWithDetails, Office } from "@/types/database"

function conditionBadgeVariant(status: string) {
  switch (status) {
    case "serviceable": return "default" as const
    case "needs_repair": return "secondary" as const
    case "unserviceable": return "destructive" as const
    case "disposed": return "outline" as const
    default: return "secondary" as const
  }
}

function statusBadgeVariant(status: string) {
  switch (status) {
    case "active": return "default" as const
    case "for_disposal": return "destructive" as const
    case "disposed": return "outline" as const
    default: return "secondary" as const
  }
}

export default function AssetRegistryPage() {
  const { canAny, can, loading: permsLoading } = usePermissions()
  const { office, loading: officeLoading } = useOffice()

  const [assets, setAssets] = useState<AssetWithDetails[]>([])
  const [deliveryItems, setDeliveryItems] = useState<Awaited<ReturnType<typeof getDeliveryItemsForRegistration>>>([])
  const [catalogItems, setCatalogItems] = useState<ItemCatalogWithDetails[]>([])
  const [offices, setOffices] = useState<Office[]>([])
  const [users, setUsers] = useState<Awaited<ReturnType<typeof getDivisionUsers>>>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [conditionFilter, setConditionFilter] = useState<string>("all")
  const [officeFilter, setOfficeFilter] = useState<string>("all")

  // Dialogs
  const [registerOpen, setRegisterOpen] = useState(false)
  const [transferAsset, setTransferAsset] = useState<AssetWithDetails | null>(null)
  const [conditionAsset, setConditionAsset] = useState<AssetWithDetails | null>(null)

  const isDivisionScoped = office?.office_type === "division_office"
  const canManage = can("asset.manage")
  const canAssign = canAny("asset.assign", "asset.manage")

  const loadData = useCallback(async () => {
    const [assetList, diItems, catalog, officeList, userList] = await Promise.all([
      getAssetRegistry(),
      canManage ? getDeliveryItemsForRegistration() : Promise.resolve([]),
      getItemCatalog(),
      getOffices(),
      canAssign ? getDivisionUsers() : Promise.resolve([]),
    ])
    setAssets(assetList)
    setDeliveryItems(diItems)
    setCatalogItems(catalog)
    setOffices(officeList)
    setUsers(userList)
    setLoading(false)
  }, [canManage, canAssign])

  useEffect(() => {
    if (!permsLoading && !officeLoading) loadData()
  }, [permsLoading, officeLoading, loadData])

  if (permsLoading || officeLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (!canAny("asset.manage", "asset.view_own", "asset.assign")) {
    return <Forbidden message="You don't have permission to view assets." />
  }

  const filtered = assets.filter((a) => {
    const matchesSearch =
      !search ||
      a.property_number.toLowerCase().includes(search.toLowerCase()) ||
      a.description?.toLowerCase().includes(search.toLowerCase()) ||
      a.serial_number?.toLowerCase().includes(search.toLowerCase()) ||
      a.brand_model?.toLowerCase().includes(search.toLowerCase())
    const matchesType = typeFilter === "all" || a.asset_type === typeFilter
    const matchesStatus = statusFilter === "all" || a.status === statusFilter
    const matchesCondition = conditionFilter === "all" || a.condition_status === conditionFilter
    const matchesOffice = officeFilter === "all" || a.office_id === officeFilter
    return matchesSearch && matchesType && matchesStatus && matchesCondition && matchesOffice
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Property Registry</h1>
          <p className="text-muted-foreground">
            Registered assets (PPE and semi-expendable).
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setRegisterOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Register Asset
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assets</CardTitle>
          <CardDescription>
            {assets.length} registered asset{assets.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search property #, description, serial..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="ppe">PPE</SelectItem>
                <SelectItem value="semi_expendable">Semi-Expendable</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="for_disposal">For Disposal</SelectItem>
                <SelectItem value="disposed">Disposed</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
                <SelectItem value="donated">Donated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={conditionFilter} onValueChange={(v) => setConditionFilter(v ?? "all")}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Conditions</SelectItem>
                <SelectItem value="serviceable">Serviceable</SelectItem>
                <SelectItem value="needs_repair">Needs Repair</SelectItem>
                <SelectItem value="unserviceable">Unserviceable</SelectItem>
              </SelectContent>
            </Select>
            {isDivisionScoped && (
              <Select value={officeFilter} onValueChange={(v) => setOfficeFilter(v ?? "all")}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="All Offices" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Offices</SelectItem>
                  {offices.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {assets.length === 0
                ? "No assets registered yet. Register assets from accepted deliveries or add them manually."
                : "No assets match your filters."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Office</TableHead>
                  <TableHead>Custodian</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead className="text-right">Book Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((asset) => (
                  <TableRow key={asset.id}>
                    <TableCell className="font-mono text-sm">
                      {asset.property_number}
                    </TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium">{asset.description ?? "—"}</span>
                        {asset.brand_model && (
                          <p className="text-xs text-muted-foreground">{asset.brand_model}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {ASSET_TYPE_LABELS[asset.asset_type] ?? asset.asset_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {asset.office?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {asset.current_custodian_profile
                        ? `${asset.current_custodian_profile.first_name} ${asset.current_custodian_profile.last_name}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={conditionBadgeVariant(asset.condition_status)}>
                        {CONDITION_STATUS_LABELS[asset.condition_status] ?? asset.condition_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {parseFloat(asset.book_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(asset.status)}>
                        {ASSET_STATUS_LABELS[asset.status] ?? asset.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          nativeButton={false}
                          render={<Link href={`/dashboard/assets/registry/${asset.id}`} />}
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canAssign && asset.status === "active" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setTransferAsset(asset)}
                            title="Transfer"
                          >
                            <ArrowRightLeft className="h-4 w-4" />
                          </Button>
                        )}
                        {canManage && asset.status === "active" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConditionAsset(asset)}
                            title="Update Condition"
                          >
                            <Wrench className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <AssetRegisterDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        deliveryItems={deliveryItems}
        catalogItems={catalogItems}
        offices={offices}
        users={users}
        onComplete={() => {
          setRegisterOpen(false)
          loadData()
        }}
      />

      <TransferAssetDialog
        open={transferAsset !== null}
        onOpenChange={(open) => !open && setTransferAsset(null)}
        asset={transferAsset}
        offices={offices}
        users={users}
        onComplete={() => {
          setTransferAsset(null)
          loadData()
        }}
      />

      <UpdateConditionDialog
        open={conditionAsset !== null}
        onOpenChange={(open) => !open && setConditionAsset(null)}
        asset={conditionAsset}
        onComplete={() => {
          setConditionAsset(null)
          loadData()
        }}
      />
    </div>
  )
}
