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
import { getFuelTypes, fuelManualStockIn } from "@/lib/actions/fuel"
import { getOffices } from "@/lib/actions/offices"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
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
import { Loader2 } from "lucide-react"
import type { FuelType } from "@/types/database"

interface Office {
  id: string
  name: string
  code: string | null
}

export default function FuelStockInPage() {
  const router = useRouter()
  const { can, loading: permsLoading } = usePermissions()
  const [fuelTypes, setFuelTypes] = useState<FuelType[]>([])
  const [offices, setOffices] = useState<Office[]>([])
  const [loading, setLoading] = useState(true)

  const form = useForm<FuelManualStockInInput>({
    resolver: zodResolver(fuelManualStockInSchema),
    defaultValues: {
      fuel_type_id: "",
      office_id: "",
      quantity_liters: 0,
      remarks: "",
    },
  })

  useEffect(() => {
    async function load() {
      const [types, officeList] = await Promise.all([
        getFuelTypes(),
        getOffices(),
      ])
      setFuelTypes(types)
      setOffices(officeList as Office[])
      setLoading(false)
    }
    load()
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

  const activeFuelTypes = fuelTypes.filter(ft => ft.is_active)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Fuel Stock In</h1>
        <p className="text-sm text-muted-foreground">
          Add fuel to inventory for an office
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Stock In Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="fuel_type_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fuel Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select fuel type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {activeFuelTypes.map(ft => (
                          <SelectItem key={ft.id} value={ft.id}>
                            {ft.name} ({ft.unit})
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
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select office" />
                        </SelectTrigger>
                      </FormControl>
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
                name="remarks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Remarks</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ""}
                        placeholder="e.g., Delivery from supplier, PO #123"
                        rows={3}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
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
