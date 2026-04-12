"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Package, Truck } from "lucide-react"
import { stockInFromDelivery, manualStockIn } from "@/lib/actions/inventory"
import { manualStockInSchema, type ManualStockInInput } from "@/lib/schemas/inventory"
import type { DeliveryWithItems, ItemCatalogWithDetails, Office } from "@/types/database"

interface StockInDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deliveries: DeliveryWithItems[]
  catalogItems: ItemCatalogWithDetails[]
  offices: Office[]
  userOfficeId?: string | null
  isDivisionScoped?: boolean
  onComplete: () => void
}

export function StockInDialog({
  open,
  onOpenChange,
  deliveries,
  catalogItems,
  offices,
  userOfficeId,
  isDivisionScoped = false,
  onComplete,
}: StockInDialogProps) {
  const [stockingIn, setStockingIn] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ManualStockInInput>({
    resolver: zodResolver(manualStockInSchema),
    defaultValues: {
      item_catalog_id: "",
      office_id: userOfficeId ?? "",
      quantity: 0,
      remarks: "",
    },
  })

  async function handleDeliveryStockIn(deliveryId: string) {
    setStockingIn(deliveryId)
    const result = await stockInFromDelivery(deliveryId)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Delivery stocked in successfully")
      onComplete()
    }
    setStockingIn(null)
  }

  async function handleManualStockIn(data: ManualStockInInput) {
    const result = await manualStockIn(data)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Manual stock in completed")
      reset()
      onComplete()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Stock In</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="delivery">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="delivery" className="flex items-center gap-2">
              <Truck className="h-4 w-4" />
              From Delivery
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Manual Entry
            </TabsTrigger>
          </TabsList>

          <TabsContent value="delivery" className="mt-4">
            {deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No deliveries ready for stock-in. Deliveries must pass inspection first.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Delivery</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((d) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const po = (d as any).purchase_order as
                      | { po_number?: string; supplier?: { name?: string }; office?: { name?: string } }
                      | null
                    return (
                      <TableRow key={d.id}>
                        <TableCell>
                          <div>
                            <span className="font-mono text-sm">{d.delivery_number}</span>
                            <p className="text-xs text-muted-foreground">
                              {d.delivery_date}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {po?.po_number ?? "—"}
                          {po?.supplier?.name && (
                            <p className="text-xs text-muted-foreground">
                              {po.supplier.name}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {d.delivery_items?.length ?? 0} items
                        </TableCell>
                        <TableCell>
                          <Badge variant="default">
                            {d.inspection_status === "passed" ? "Passed" : "Partial"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            onClick={() => handleDeliveryStockIn(d.id)}
                            disabled={stockingIn !== null}
                          >
                            {stockingIn === d.id ? "Processing..." : "Stock In"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="manual" className="mt-4">
            <form onSubmit={handleSubmit(handleManualStockIn)} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Add pre-existing items to inventory. Use this for items that existed
                before the system was deployed.
              </p>

              <div className="space-y-2">
                <Label>Item *</Label>
                <Select
                  value={watch("item_catalog_id")}
                  onValueChange={(v) => setValue("item_catalog_id", v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an item from catalog" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.code} — {item.name} ({item.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.item_catalog_id && (
                  <p className="text-sm text-destructive">{errors.item_catalog_id.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Office *</Label>
                {isDivisionScoped ? (
                  <Select
                    value={watch("office_id")}
                    onValueChange={(v) => setValue("office_id", v ?? "")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select office" />
                    </SelectTrigger>
                    <SelectContent>
                      {offices.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={offices.find(o => o.id === userOfficeId)?.name ?? "Your office"}
                    disabled
                  />
                )}
                {errors.office_id && (
                  <p className="text-sm text-destructive">{errors.office_id.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="manual-quantity">Quantity *</Label>
                <Input
                  id="manual-quantity"
                  type="number"
                  step="0.01"
                  min="0.01"
                  {...register("quantity")}
                />
                {errors.quantity && (
                  <p className="text-sm text-destructive">{errors.quantity.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="manual-remarks">Remarks</Label>
                <Textarea
                  id="manual-remarks"
                  {...register("remarks")}
                  placeholder="e.g. Existing stock as of system deployment"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Processing..." : "Stock In"}
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
