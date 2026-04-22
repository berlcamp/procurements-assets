"use client"

import { useEffect, useState, useCallback } from "react"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import { Plus, Pencil, Search } from "lucide-react"
import {
  getItemCatalog,
  createItemCatalogEntry,
  updateItemCatalogEntry,
  deleteItemCatalogEntry,
} from "@/lib/actions/inventory"
import { getAccountCodes } from "@/lib/actions/account-codes"
import { ItemCatalogForm } from "@/components/inventory/item-catalog-form"
import { ITEM_CATEGORY_LABELS, type ItemCatalogInput } from "@/lib/schemas/inventory"
import type { ItemCatalogWithDetails, AccountCode } from "@/types/database"

const CATEGORY_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  consumable: "secondary",
  semi_expendable: "default",
  ppe: "outline",
}

export default function ItemCatalogPage() {
  const { canAny, loading: permsLoading } = usePermissions()
  const [items, setItems] = useState<ItemCatalogWithDetails[]>([])
  const [accountCodes, setAccountCodes] = useState<AccountCode[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ItemCatalogWithDetails | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")

  const loadData = useCallback(async () => {
    const [catalogItems, codes] = await Promise.all([
      getItemCatalog(),
      getAccountCodes(),
    ])
    setItems(catalogItems)
    setAccountCodes(codes)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  async function handleSubmit(data: ItemCatalogInput) {
    setSaving(true)
    try {
      if (editingItem) {
        const result = await updateItemCatalogEntry(editingItem.id, data)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success("Item updated successfully")
      } else {
        const result = await createItemCatalogEntry(data)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success("Item created successfully")
      }
      setDialogOpen(false)
      setEditingItem(null)
      await loadData()
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(item: ItemCatalogWithDetails) {
    if (item.is_active) {
      const result = await updateItemCatalogEntry(item.id, {
        ...item,
        description: item.description ?? undefined,
        account_code_id: item.account_code_id ?? undefined,
        useful_life_years: item.useful_life_years ?? undefined,
        is_active: false,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Item deactivated")
    } else {
      const result = await updateItemCatalogEntry(item.id, {
        ...item,
        description: item.description ?? undefined,
        account_code_id: item.account_code_id ?? undefined,
        useful_life_years: item.useful_life_years ?? undefined,
        is_active: true,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Item activated")
    }
    await loadData()
  }

  async function handleDelete(item: ItemCatalogWithDetails) {
    const result = await deleteItemCatalogEntry(item.id)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Item removed from catalog")
    await loadData()
  }

  if (permsLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  if (!canAny("inventory.manage", "asset.manage")) {
    return (
      <Forbidden
        message="You don't have permission to manage the item catalog. Only Supply Officers and Division Admins can access this page."
      />
    )
  }

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.code.toLowerCase().includes(search.toLowerCase())
    const matchesCategory =
      categoryFilter === "all" || item.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Item Catalog</h1>
          <p className="text-muted-foreground">
            Manage the master catalog of items tracked across the division.
          </p>
        </div>
        {canAny("inventory.manage", "asset.manage") && (
          <Button
            onClick={() => {
              setEditingItem(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Item
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Items</CardTitle>
          <CardDescription>
            {items.length} item{items.length !== 1 ? "s" : ""} in catalog
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? "all")}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="consumable">Consumable</SelectItem>
                <SelectItem value="semi_expendable">Semi-Expendable</SelectItem>
                <SelectItem value="ppe">PPE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : filteredItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {items.length === 0
                ? "No items in catalog yet. Add your first item."
                : "No items match your filters."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Account Code</TableHead>
                  <TableHead>Useful Life</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-sm">{item.code}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <Badge variant={CATEGORY_BADGE_VARIANT[item.category] ?? "outline"}>
                        {ITEM_CATEGORY_LABELS[item.category] ?? item.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{item.unit}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.account_code
                        ? `${item.account_code.code}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {item.useful_life_years ? `${item.useful_life_years} yrs` : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.is_active ? "default" : "outline"}>
                        {item.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingItem(item)
                            setDialogOpen(true)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? "Edit Item" : "Add Item to Catalog"}
            </DialogTitle>
          </DialogHeader>
          <ItemCatalogForm
            item={editingItem}
            accountCodes={accountCodes}
            onSubmit={handleSubmit}
            onCancel={() => {
              setDialogOpen(false)
              setEditingItem(null)
            }}
            saving={saving}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
