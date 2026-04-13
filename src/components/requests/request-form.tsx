"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { createRequest, submitRequest } from "@/lib/actions/requests"
import {
  createRequestSchema,
  type CreateRequestInput,
  REQUEST_TYPE_LABELS,
  URGENCY_LABELS,
  REQUEST_TYPES,
  URGENCY_LEVELS,
} from "@/lib/schemas/request"
import type { ItemCatalogWithDetails } from "@/types/database"

interface RequestFormProps {
  officeId: string
  catalogItems: ItemCatalogWithDetails[]
}

export function RequestForm({ officeId, catalogItems }: RequestFormProps) {
  const router = useRouter()
  const [submitAfterCreate, setSubmitAfterCreate] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateRequestInput>({
    resolver: zodResolver(createRequestSchema),
    defaultValues: {
      request_type: "supply",
      office_id: officeId,
      purpose: "",
      urgency: "normal",
      items: [{ item_catalog_id: null, description: "", unit: "pc", quantity_requested: 1, remarks: null }],
    },
  })

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  })

  const requestType = watch("request_type")

  function onCatalogSelect(index: number, catalogId: string) {
    const item = catalogItems.find(c => c.id === catalogId)
    if (item) {
      setValue(`items.${index}.item_catalog_id`, catalogId)
      setValue(`items.${index}.description`, item.name)
      setValue(`items.${index}.unit`, item.unit)
    }
  }

  async function onSubmit(data: CreateRequestInput) {
    const result = await createRequest(data)
    if (result.error) {
      toast.error(result.error)
      return
    }

    if (submitAfterCreate && result.id) {
      const submitResult = await submitRequest(result.id)
      if (submitResult.error) {
        toast.error(`Created but failed to submit: ${submitResult.error}`)
        router.push(`/dashboard/requests/${result.id}`)
        return
      }
      toast.success("Request created and submitted for approval")
    } else {
      toast.success("Request saved as draft")
    }

    router.push(result.id ? `/dashboard/requests/${result.id}` : "/dashboard/requests")
  }

  const isService = requestType === "service"

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Request Details */}
      <Card>
        <CardHeader>
          <CardTitle>Request Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Request Type *</Label>
              <Select
                value={watch("request_type")}
                onValueChange={(v) => setValue("request_type", v as typeof REQUEST_TYPES[number])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_TYPES.map(type => (
                    <SelectItem key={type} value={type}>
                      {REQUEST_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.request_type && (
                <p className="text-sm text-destructive">{errors.request_type.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Urgency *</Label>
              <Select
                value={watch("urgency")}
                onValueChange={(v) => setValue("urgency", v as typeof URGENCY_LEVELS[number])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {URGENCY_LEVELS.map(level => (
                    <SelectItem key={level} value={level}>
                      {URGENCY_LABELS[level]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.urgency && (
                <p className="text-sm text-destructive">{errors.urgency.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="purpose">Purpose *</Label>
            <Textarea
              id="purpose"
              {...register("purpose")}
              placeholder="Describe the purpose of this request..."
              rows={3}
            />
            {errors.purpose && (
              <p className="text-sm text-destructive">{errors.purpose.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Request Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Items</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ item_catalog_id: null, description: "", unit: "pc", quantity_requested: 1, remarks: null })}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Item
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {errors.items?.root && (
            <p className="text-sm text-destructive">{errors.items.root.message}</p>
          )}

          {fields.map((field, index) => (
            <div key={field.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Item #{index + 1}
                </span>
                {fields.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {!isService && (
                <div className="space-y-2">
                  <Label>Item from Catalog</Label>
                  <Select
                    value={watch(`items.${index}.item_catalog_id`) ?? ""}
                    onValueChange={(v) => v && onCatalogSelect(index, v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select catalog item..." />
                    </SelectTrigger>
                    <SelectContent>
                      {catalogItems.map(item => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.code} — {item.name} ({item.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1 space-y-2">
                  <Label>Description *</Label>
                  <Input
                    {...register(`items.${index}.description`)}
                    placeholder="Item description"
                  />
                  {errors.items?.[index]?.description && (
                    <p className="text-sm text-destructive">{errors.items[index].description?.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Unit *</Label>
                  <Input
                    {...register(`items.${index}.unit`)}
                    placeholder="pc, box, set..."
                  />
                  {errors.items?.[index]?.unit && (
                    <p className="text-sm text-destructive">{errors.items[index].unit?.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Quantity *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    {...register(`items.${index}.quantity_requested`, { valueAsNumber: true })}
                  />
                  {errors.items?.[index]?.quantity_requested && (
                    <p className="text-sm text-destructive">{errors.items[index].quantity_requested?.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Remarks</Label>
                <Input
                  {...register(`items.${index}.remarks`)}
                  placeholder="Optional notes..."
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.push("/dashboard/requests")}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => setSubmitAfterCreate(false)}
        >
          {isSubmitting && !submitAfterCreate ? "Saving..." : "Save as Draft"}
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          onClick={() => setSubmitAfterCreate(true)}
        >
          {isSubmitting && submitAfterCreate ? "Submitting..." : "Save & Submit"}
        </Button>
      </div>
    </form>
  )
}
