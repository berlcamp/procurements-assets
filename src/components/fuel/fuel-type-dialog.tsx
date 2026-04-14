"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { fuelTypeSchema, type FuelTypeInput } from "@/lib/schemas/fuel"
import { createFuelType } from "@/lib/actions/fuel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Label } from "@/components/ui/label"
import { Loader2, Plus, Fuel, Droplets } from "lucide-react"

interface FuelTypeDialogProps {
  onCreated: () => void
}

export function FuelTypeDialog({ onCreated }: FuelTypeDialogProps) {
  const [open, setOpen] = useState(false)

  const form = useForm<FuelTypeInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(fuelTypeSchema) as any,
    defaultValues: {
      name: "",
      unit: "liters",
      price_per_unit: null,
      is_active: true,
    },
  })

  async function onSubmit(data: FuelTypeInput) {
    const result = await createFuelType(data)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success("Fuel type created successfully")
    form.reset()
    setOpen(false)
    onCreated()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) form.reset() }}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        Add Fuel Type
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-primary" />
            Add Fuel Type
          </DialogTitle>
          <DialogDescription>
            Register a new fuel type for your division. Common types include
            Gasoline (Unleaded), Diesel, and Premium.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-1">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fuel Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Gasoline, Diesel, Premium" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit of Measure</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="liters" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="price_per_unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price / Unit (PHP)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        value={field.value ?? ""}
                        onChange={e =>
                          field.onChange(
                            e.target.value ? e.target.valueAsNumber : null
                          )
                        }
                        placeholder="e.g., 65.50"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                <Fuel className="inline h-3 w-3 mr-1 -mt-0.5" />
                Price per unit is optional and used for cost estimation on voucher slips.
                You can update it anytime as market prices change.
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setOpen(false); form.reset() }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-1.5" />
                )}
                Create Fuel Type
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
