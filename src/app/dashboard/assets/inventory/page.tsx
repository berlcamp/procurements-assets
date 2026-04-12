"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { useOffice } from "@/lib/hooks/use-office"
import { Forbidden } from "@/components/shared/forbidden"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
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
import { toast } from "sonner"
import { Search, Plus, ArrowDownToLine, ArrowUpFromLine, Settings, Eye } from "lucide-react"
import {
  getInventoryList,
  getItemCatalog,
  getDeliveriesReadyForStockIn,
} from "@/lib/actions/inventory"
import { getOffices } from "@/lib/actions/offices"
import { StockInDialog } from "@/components/inventory/stock-in-dialog"
import { StockOutDialog } from "@/components/inventory/stock-out-dialog"
import { InventorySettingsDialog } from "@/components/inventory/inventory-settings-dialog"
import { ITEM_CATEGORY_LABELS } from "@/lib/schemas/inventory"
import type {
  InventoryWithDetails,
  ItemCatalogWithDetails,
  DeliveryWithItems,
  Office,
} from "@/types/database"

export default function InventoryListPage() {
  const { canAny, can, loading: permsLoading } = usePermissions()
  const { office, officeId, loading: officeLoading } = useOffice()

  const [inventory, setInventory] = useState<InventoryWithDetails[]>([])
  const [catalogItems, setCatalogItems] = useState<ItemCatalogWithDetails[]>([])
  const [deliveries, setDeliveries] = useState<DeliveryWithItems[]>([])
  const [offices, setOffices] = useState<Office[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [officeFilter, setOfficeFilter] = useState<string>("all")
  const [lowStockOnly, setLowStockOnly] = useState(false)

  // Dialogs
  const [stockInOpen, setStockInOpen] = useState(false)
  const [stockOutItem, setStockOutItem] = useState<InventoryWithDetails | null>(null)
  const [settingsItem, setSettingsItem] = useState<InventoryWithDetails | null>(null)

  const isDivisionScoped = office?.office_type === "division_office"
  const canManage = canAny("inventory.manage", "asset.manage")

  const loadData = useCallback(async () => {
    const [inv, catalog, dels, officeList] = await Promise.all([
      getInventoryList(),
      getItemCatalog(),
      canManage ? getDeliveriesReadyForStockIn() : Promise.resolve([]),
      getOffices(),
    ])
    setInventory(inv)
    setCatalogItems(catalog)
    setDeliveries(dels)
    setOffices(officeList)
    setLoading(false)
  }, [canManage])

  useEffect(() => {
    if (!permsLoading && !officeLoading) {
      loadData()
    }
  }, [permsLoading, officeLoading, loadData])

  if (permsLoading || officeLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (!canAny("asset.manage", "asset.view_own", "inventory.manage")) {
    return (
      <Forbidden message="You don't have permission to view inventory." />
    )
  }

  const filtered = inventory.filter((inv) => {
    const matchesSearch =
      !search ||
      inv.item_catalog?.name?.toLowerCase().includes(search.toLowerCase()) ||
      inv.item_catalog?.code?.toLowerCase().includes(search.toLowerCase())
    const matchesCategory =
      categoryFilter === "all" || inv.item_catalog?.category === categoryFilter
    const matchesOffice =
      officeFilter === "all" || inv.office_id === officeFilter
    const matchesLowStock =
      !lowStockOnly ||
      (parseFloat(inv.reorder_point) > 0 &&
        parseFloat(inv.current_quantity) <= parseFloat(inv.reorder_point))
    return matchesSearch && matchesCategory && matchesOffice && matchesLowStock
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-muted-foreground">
            Stock levels across {isDivisionScoped ? "all offices" : (office?.name ?? "your office")}.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setStockInOpen(true)}>
            <ArrowDownToLine className="mr-2 h-4 w-4" />
            Stock In
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stock List</CardTitle>
          <CardDescription>
            {inventory.length} inventory record{inventory.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by item name or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? "all")}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="consumable">Consumable</SelectItem>
                <SelectItem value="semi_expendable">Semi-Expendable</SelectItem>
                <SelectItem value="ppe">PPE</SelectItem>
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
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-2">
              <Switch
                checked={lowStockOnly}
                onCheckedChange={setLowStockOnly}
                id="low-stock"
              />
              <Label htmlFor="low-stock" className="text-sm">Low stock only</Label>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {inventory.length === 0
                ? "No inventory records yet. Stock in items from deliveries or add them manually."
                : "No items match your filters."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Item Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Office</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Reorder Pt</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((inv) => {
                  const qty = parseFloat(inv.current_quantity)
                  const reorder = parseFloat(inv.reorder_point)
                  const isLow = reorder > 0 && qty <= reorder
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm">
                        {inv.item_catalog?.code ?? "—"}
                      </TableCell>
                      <TableCell className="font-medium">
                        {inv.item_catalog?.name ?? "Unknown"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {ITEM_CATEGORY_LABELS[inv.item_catalog?.category ?? ""] ?? inv.item_catalog?.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {inv.office?.name ?? "—"}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-medium ${isLow ? "text-orange-600" : ""}`}>
                        {qty.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {reorder > 0 ? reorder.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {inv.location ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            nativeButton={false}
                            render={<Link href={`/dashboard/assets/inventory/${inv.id}`} />}
                            title="View Stock Card"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canManage && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setStockOutItem(inv)}
                                title="Stock Out"
                                disabled={qty <= 0}
                              >
                                <ArrowUpFromLine className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setSettingsItem(inv)}
                                title="Settings"
                              >
                                <Settings className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <StockInDialog
        open={stockInOpen}
        onOpenChange={setStockInOpen}
        deliveries={deliveries}
        catalogItems={catalogItems}
        offices={offices}
        userOfficeId={officeId}
        isDivisionScoped={isDivisionScoped}
        onComplete={() => {
          setStockInOpen(false)
          loadData()
        }}
      />

      <StockOutDialog
        open={stockOutItem !== null}
        onOpenChange={(open) => !open && setStockOutItem(null)}
        inventory={stockOutItem}
        onComplete={() => {
          setStockOutItem(null)
          loadData()
        }}
      />

      <InventorySettingsDialog
        open={settingsItem !== null}
        onOpenChange={(open) => !open && setSettingsItem(null)}
        inventory={settingsItem}
        onComplete={() => {
          setSettingsItem(null)
          loadData()
        }}
      />
    </div>
  )
}
