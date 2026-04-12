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
import { Truck, PenLine } from "lucide-react"
import {
  registerAssetFromDelivery,
  registerAssetManual,
} from "@/lib/actions/assets"
import {
  registerAssetFromDeliverySchema,
  registerAssetManualSchema,
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  type RegisterAssetFromDeliveryInput,
  type RegisterAssetManualInput,
} from "@/lib/schemas/asset"
import type { ItemCatalogWithDetails, Office } from "@/types/database"

interface DeliveryItemForRegistration {
  delivery_item_id: string
  delivery_number: string
  delivery_id: string
  delivery_date: string
  po_number: string
  description: string
  unit: string
  unit_cost: string
  quantity_accepted: string
  registered_count: number
  remaining: number
  office_id: string | null
  office_name: string | null
  category: string
}

interface AssetRegisterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deliveryItems: DeliveryItemForRegistration[]
  catalogItems: ItemCatalogWithDetails[]
  offices: Office[]
  users: Array<{ id: string; first_name: string; last_name: string; office_name: string | null }>
  onComplete: () => void
}

export function AssetRegisterDialog({
  open,
  onOpenChange,
  deliveryItems,
  catalogItems,
  offices,
  users,
  onComplete,
}: AssetRegisterDialogProps) {
  const [registering, setRegistering] = useState<string | null>(null)
  const [expandedItem, setExpandedItem] = useState<string | null>(null)

  // Delivery registration form (per delivery item)
  const deliveryForm = useForm<RegisterAssetFromDeliveryInput>({
    resolver: zodResolver(registerAssetFromDeliverySchema),
  })

  // Manual registration form
  const manualForm = useForm<RegisterAssetManualInput>({
    resolver: zodResolver(registerAssetManualSchema),
    defaultValues: {
      item_catalog_id: "",
      office_id: "",
      description: "",
      brand_model: "",
      serial_number: "",
      acquisition_date: "",
      acquisition_cost: 0,
      asset_type: "ppe",
      location: "",
      custodian_id: null,
      useful_life_years: null,
      residual_value: 0,
    },
  })

  function handleExpandItem(deliveryItemId: string) {
    if (expandedItem === deliveryItemId) {
      setExpandedItem(null)
      return
    }
    setExpandedItem(deliveryItemId)
    deliveryForm.reset({
      delivery_item_id: deliveryItemId,
      brand_model: "",
      serial_number: "",
      location: "",
      custodian_id: null,
      residual_value: 0,
      useful_life_years: null,
    })
  }

  async function handleDeliveryRegister(data: RegisterAssetFromDeliveryInput) {
    setRegistering(data.delivery_item_id)
    const result = await registerAssetFromDelivery(data)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Asset registered successfully")
      setExpandedItem(null)
      onComplete()
    }
    setRegistering(null)
  }

  async function handleManualRegister(data: RegisterAssetManualInput) {
    const result = await registerAssetManual(data)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Asset registered successfully")
      manualForm.reset()
      onComplete()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register Asset</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="delivery">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="delivery" className="flex items-center gap-2">
              <Truck className="h-4 w-4" />
              From Delivery
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              Manual Entry
            </TabsTrigger>
          </TabsList>

          <TabsContent value="delivery" className="mt-4">
            {deliveryItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No delivery items ready for asset registration. Items must be semi-expendable or PPE
                and stocked in first.
              </p>
            ) : (
              <div className="space-y-2">
                {deliveryItems.map((item) => (
                  <div key={item.delivery_item_id} className="border rounded-lg">
                    <div
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50"
                      onClick={() => handleExpandItem(item.delivery_item_id)}
                    >
                      <div className="space-y-0.5">
                        <div className="font-medium text-sm">{item.description}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{item.delivery_number}</span>
                          <span>/</span>
                          <span>PO: {item.po_number}</span>
                          <Badge variant="secondary" className="text-xs">
                            {item.category === "ppe" ? "PPE" : "Semi-Expendable"}
                          </Badge>
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-mono">
                          {item.remaining} of {Math.floor(parseFloat(item.quantity_accepted))}
                        </div>
                        <div className="text-xs text-muted-foreground">remaining</div>
                      </div>
                    </div>

                    {expandedItem === item.delivery_item_id && (
                      <form
                        onSubmit={deliveryForm.handleSubmit(handleDeliveryRegister)}
                        className="border-t p-3 space-y-3 bg-muted/30"
                      >
                        <p className="text-xs text-muted-foreground">
                          Unit cost: {parseFloat(item.unit_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          {" / "}{item.unit}
                          {item.office_name && ` — ${item.office_name}`}
                        </p>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Brand / Model</Label>
                            <Input
                              {...deliveryForm.register("brand_model")}
                              placeholder="e.g. HP LaserJet Pro"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Serial Number</Label>
                            <Input
                              {...deliveryForm.register("serial_number")}
                              placeholder="e.g. SN12345"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Location</Label>
                            <Input
                              {...deliveryForm.register("location")}
                              placeholder="e.g. Room 101"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Useful Life (years)</Label>
                            <Input
                              type="number"
                              min="1"
                              {...deliveryForm.register("useful_life_years", { valueAsNumber: true })}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Residual Value</Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              {...deliveryForm.register("residual_value", { valueAsNumber: true })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Assign to Custodian</Label>
                            <Select
                              value={deliveryForm.watch("custodian_id") ?? ""}
                              onValueChange={(v) => deliveryForm.setValue("custodian_id", v || null)}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select custodian (optional)" />
                              </SelectTrigger>
                              <SelectContent>
                                {users.map((u) => (
                                  <SelectItem key={u.id} value={u.id}>
                                    {u.last_name}, {u.first_name}
                                    {u.office_name && (
                                      <span className="text-muted-foreground ml-1">
                                        ({u.office_name})
                                      </span>
                                    )}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setExpandedItem(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={registering !== null}
                          >
                            {registering === item.delivery_item_id ? "Registering..." : "Register Asset"}
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual" className="mt-4">
            <form onSubmit={manualForm.handleSubmit(handleManualRegister)} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Register pre-existing assets not from deliveries.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Item Catalog *</Label>
                  <Select
                    value={manualForm.watch("item_catalog_id")}
                    onValueChange={(v) => manualForm.setValue("item_catalog_id", v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select item">
                        {(() => {
                          const sel = catalogItems.find(i => i.id === manualForm.watch("item_catalog_id"))
                          return sel ? `${sel.code} — ${sel.name}` : null
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-none">
                      {catalogItems
                        .filter(i => ["semi_expendable", "ppe"].includes(i.category))
                        .map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            <span className="font-mono text-xs">{item.code}</span>
                            <span className="ml-1">— {item.name}</span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {manualForm.formState.errors.item_catalog_id && (
                    <p className="text-sm text-destructive">{manualForm.formState.errors.item_catalog_id.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Office *</Label>
                  <Select
                    value={manualForm.watch("office_id")}
                    onValueChange={(v) => manualForm.setValue("office_id", v ?? "")}
                  >
                    <SelectTrigger className="w-full">
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
                  {manualForm.formState.errors.office_id && (
                    <p className="text-sm text-destructive">{manualForm.formState.errors.office_id.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description *</Label>
                <Input {...manualForm.register("description")} placeholder="Asset description" />
                {manualForm.formState.errors.description && (
                  <p className="text-sm text-destructive">{manualForm.formState.errors.description.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Asset Type *</Label>
                  <Select
                    value={manualForm.watch("asset_type")}
                    onValueChange={(v) => manualForm.setValue("asset_type", v as "semi_expendable" | "ppe")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSET_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {ASSET_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Acquisition Date *</Label>
                  <Input type="date" {...manualForm.register("acquisition_date")} />
                  {manualForm.formState.errors.acquisition_date && (
                    <p className="text-sm text-destructive">{manualForm.formState.errors.acquisition_date.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Acquisition Cost *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    {...manualForm.register("acquisition_cost", { valueAsNumber: true })}
                  />
                  {manualForm.formState.errors.acquisition_cost && (
                    <p className="text-sm text-destructive">{manualForm.formState.errors.acquisition_cost.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Useful Life (years)</Label>
                  <Input
                    type="number"
                    min="1"
                    {...manualForm.register("useful_life_years", { valueAsNumber: true })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Residual Value</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    {...manualForm.register("residual_value", { valueAsNumber: true })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Brand / Model</Label>
                  <Input {...manualForm.register("brand_model")} placeholder="e.g. HP LaserJet Pro" />
                </div>
                <div className="space-y-2">
                  <Label>Serial Number</Label>
                  <Input {...manualForm.register("serial_number")} placeholder="e.g. SN12345" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Input {...manualForm.register("location")} placeholder="e.g. Room 101" />
                </div>
                <div className="space-y-2">
                  <Label>Assign to Custodian</Label>
                  <Select
                    value={manualForm.watch("custodian_id") ?? ""}
                    onValueChange={(v) => manualForm.setValue("custodian_id", v || null)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select custodian (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.last_name}, {u.first_name}
                          {u.office_name && (
                            <span className="text-muted-foreground ml-1">({u.office_name})</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={manualForm.formState.isSubmitting}>
                  {manualForm.formState.isSubmitting ? "Registering..." : "Register Asset"}
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
