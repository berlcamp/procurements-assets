"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  itemCatalogSchema,
  type ItemCatalogInput,
  ITEM_CATEGORIES,
  ITEM_CATEGORY_LABELS,
} from "@/lib/schemas/inventory"
import type { AccountCode, ItemCatalog } from "@/types/database"

interface ItemCatalogFormProps {
  item?: ItemCatalog | null
  accountCodes: AccountCode[]
  onSubmit: (data: ItemCatalogInput) => Promise<void>
  onCancel: () => void
  saving?: boolean
}

export function ItemCatalogForm({
  item,
  accountCodes,
  onSubmit,
  onCancel,
  saving = false,
}: ItemCatalogFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ItemCatalogInput>({
    resolver: zodResolver(itemCatalogSchema),
    defaultValues: {
      code: item?.code ?? "",
      name: item?.name ?? "",
      description: item?.description ?? "",
      category: item?.category ?? "consumable",
      unit: item?.unit ?? "",
      account_code_id: item?.account_code_id ?? null,
      useful_life_years: item?.useful_life_years ?? null,
      is_active: item?.is_active ?? true,
    },
  })

  const category = watch("category")
  const isActive = watch("is_active")

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="code">Item Code *</Label>
          <Input id="code" {...register("code")} placeholder="e.g. SUP-001" />
          {errors.code && (
            <p className="text-sm text-destructive">{errors.code.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="unit">Unit of Measure *</Label>
          <Input id="unit" {...register("unit")} placeholder="e.g. pc, box, ream" />
          {errors.unit && (
            <p className="text-sm text-destructive">{errors.unit.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Item Name *</Label>
        <Input id="name" {...register("name")} placeholder="Item name" />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          {...register("description")}
          placeholder="Optional description"
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label>Category *</Label>
        <Select
          value={category}
          onValueChange={(v) => setValue("category", v as ItemCatalogInput["category"])}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {ITEM_CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {ITEM_CATEGORY_LABELS[cat]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.category && (
          <p className="text-sm text-destructive">{errors.category.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Account Code</Label>
        <Select
          value={watch("account_code_id") ?? "none"}
          onValueChange={(v) => setValue("account_code_id", v === "none" ? null : v)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select account code" />
          </SelectTrigger>
          <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-none">
            <SelectItem value="none">None</SelectItem>
            {accountCodes.map((ac) => (
              <SelectItem key={ac.id} value={ac.id}>
                <span className="font-mono text-xs">{ac.code}</span>
                <span className="ml-1 text-muted-foreground">— {ac.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {(category === "semi_expendable" || category === "ppe") && (
        <div className="space-y-2">
          <Label htmlFor="useful_life_years">Useful Life (years)</Label>
          <Input
            id="useful_life_years"
            type="number"
            min={0}
            {...register("useful_life_years")}
            placeholder="e.g. 5"
          />
          {errors.useful_life_years && (
            <p className="text-sm text-destructive">{errors.useful_life_years.message}</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Switch
          checked={isActive}
          onCheckedChange={(checked) => setValue("is_active", checked)}
        />
        <Label>Active</Label>
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : item ? "Update Item" : "Create Item"}
        </Button>
      </div>
    </form>
  )
}
