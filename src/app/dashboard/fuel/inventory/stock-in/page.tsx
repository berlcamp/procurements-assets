"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { Forbidden } from "@/components/shared/forbidden"
import {
  fuelManualStockInSchema,
  type FuelManualStockInInput,
} from "@/lib/schemas/fuel"
import { ensureDefaultFuelTypes, fuelManualStockIn } from "@/lib/actions/fuel"
import { getOffices } from "@/lib/actions/offices"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Droplets, ArrowLeft, Fuel } from "lucide-react"
import Link from "next/link"

interface Office {
  id: string
  name: string
  code: string | null
}

export default function FuelStockInPage() {
  const router = useRouter()
  const { can, loading: permsLoading } = usePermissions()
  const [fuelTypeMap, setFuelTypeMap] = useState<Record<string, string>>({})
  const [offices, setOffices] = useState<Office[]>([])
  const [loading, setLoading] = useState(true)

  const form = useForm<FuelManualStockInInput>({
    resolver: zodResolver(fuelManualStockInSchema),
    defaultValues: {
      fuel_type_id: "",
      office_id: "",
      quantity_liters: 0,
      price_per_liter: undefined,
      po_number: "",
      remarks: "",
    },
  })

  useEffect(() => {
    async function loadData() {
      const [typeMap, officeList] = await Promise.all([
        ensureDefaultFuelTypes(),
        getOffices(),
      ])
      setFuelTypeMap(typeMap)
      setOffices(officeList as Office[])
      setLoading(false)
    }
    loadData()
  }, [])

  if (permsLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!can("fuel.manage_inventory")) {
    return <Forbidden message="You don't have permission to manage fuel inventory." />
  }

  async function onSubmit(data: FuelManualStockInInput) {
    const result = await fuelManualStockIn(data)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success("Fuel stock added successfully")
    router.push("/dashboard/fuel/inventory")
    router.refresh()
  }

  const fuelOptions = [
    { label: "Gasoline", id: fuelTypeMap["Gasoline"], icon: "⛽" },
    { label: "Diesel", id: fuelTypeMap["Diesel"], icon: "🛢️" },
  ].filter(opt => opt.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" nativeButton={false} render={<Link href="/dashboard/fuel/inventory" />}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Fuel Stock In</h1>
          <p className="text-sm text-muted-foreground">
            Record a new fuel delivery into inventory
          </p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            Stock In Details
          </CardTitle>
          <CardDescription>
            Enter the fuel delivery details. Stock is tracked per office using FIFO
            (first-in, first-out) — oldest stock is consumed first when requests are approved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              {/* Fuel Type & Office */}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="fuel_type_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fuel Type *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select fuel type">
                            {(value: string) => {
                              const opt = fuelOptions.find(o => o.id === value)
                              return opt ? `${opt.icon} ${opt.label}` : value
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {fuelOptions.map(opt => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt.icon} {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="office_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Office *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select office">
                            {(value: string) => offices.find(o => o.id === value)?.name ?? value}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {offices.map(office => (
                            <SelectItem key={office.id} value={office.id}>
                              {office.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Quantity & Price */}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="quantity_liters"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity (Liters) *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={field.value || ""}
                          onChange={e => field.onChange(e.target.valueAsNumber || 0)}
                          placeholder="e.g., 500"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="price_per_liter"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price per Liter (PHP)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={field.value ?? ""}
                          onChange={e => field.onChange(e.target.value ? e.target.valueAsNumber : undefined)}
                          placeholder="e.g., 65.50"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Computed total cost hint */}
              {form.watch("quantity_liters") > 0 && form.watch("price_per_liter") && (
                <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-sm flex items-center gap-2">
                  <Fuel className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Estimated Total Cost: </span>
                  <span className="font-semibold">
                    PHP {(
                      (form.watch("quantity_liters") || 0) *
                      (form.watch("price_per_liter") || 0)
                    ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}

              {/* PO Number */}
              <FormField
                control={form.control}
                name="po_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PO Number</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        placeholder="e.g., PO-2026-0042 (optional)"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Remarks */}
              <FormField
                control={form.control}
                name="remarks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Remarks</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ""}
                        placeholder="e.g., Delivery from Shell, received by Juan Dela Cruz"
                        rows={2}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Droplets className="h-4 w-4 mr-1.5" />
                  )}
                  Add Stock
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
