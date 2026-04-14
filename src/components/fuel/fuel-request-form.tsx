"use client"

import { useRouter } from "next/navigation"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import {
  createFuelRequestSchema,
  type CreateFuelRequestInput,
  VEHICLE_TYPES,
} from "@/lib/schemas/fuel"
import { createFuelRequest } from "@/lib/actions/fuel"
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
import { Plus, Trash2, Loader2 } from "lucide-react"

interface FuelRequestFormProps {
  officeId: string
  fuelTypeMap: Record<string, string>
}

export function FuelRequestForm({ officeId, fuelTypeMap }: FuelRequestFormProps) {
  const router = useRouter()

  const form = useForm<CreateFuelRequestInput>({
    resolver: zodResolver(createFuelRequestSchema),
    defaultValues: {
      office_id: officeId,
      fuel_type_id: "",
      date_of_trip: "",
      destination: "",
      purpose: "",
      vehicle_type: "",
      vehicle_plate_number: "",
      passengers: [],
      liters_requested: 0,
      km_departure: undefined,
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "passengers",
  })

  async function onSubmit(data: CreateFuelRequestInput) {
    const result = await createFuelRequest(data)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success("Trip ticket submitted successfully")
    router.push("/dashboard/fuel/requests")
    router.refresh()
  }

  const fuelOptions = [
    { label: "Gasoline", id: fuelTypeMap["Gasoline"], icon: "⛽" },
    { label: "Diesel", id: fuelTypeMap["Diesel"], icon: "🛢️" },
  ].filter(opt => opt.id)

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Trip Details */}
        <Card>
          <CardHeader>
            <CardTitle>Trip Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="date_of_trip"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of Trip *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="destination"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Destination *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., DepEd Regional Office" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="purpose"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Purpose of Trip *</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Describe the purpose of this trip" rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Vehicle Information */}
        <Card>
          <CardHeader>
            <CardTitle>Vehicle Information</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="vehicle_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vehicle Type *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select vehicle type" />
                    </SelectTrigger>
                    <SelectContent>
                      {VEHICLE_TYPES.map(type => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="vehicle_plate_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Plate Number *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., ABC 1234" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="km_departure"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Odometer at Departure (km)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      value={field.value ?? ""}
                      onChange={e => field.onChange(e.target.value ? e.target.valueAsNumber : undefined)}
                      placeholder="Optional"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Passengers */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Passengers</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ name: "", position: "" })}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Passenger
            </Button>
          </CardHeader>
          <CardContent>
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No passengers added. Click &quot;Add Passenger&quot; to add.
              </p>
            ) : (
              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div key={field.id} className="flex gap-3 items-start">
                    <FormField
                      control={form.control}
                      name={`passengers.${index}.name`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          {index === 0 && <FormLabel>Name</FormLabel>}
                          <FormControl>
                            <Input {...field} placeholder="Full name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`passengers.${index}.position`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          {index === 0 && <FormLabel>Position</FormLabel>}
                          <FormControl>
                            <Input {...field} placeholder="Designation / position" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={index === 0 ? "mt-8" : ""}
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fuel Request */}
        <Card>
          <CardHeader>
            <CardTitle>Fuel Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
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
              name="liters_requested"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Liters Requested *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={field.value || ""}
                      onChange={e => field.onChange(e.target.valueAsNumber || 0)}
                      placeholder="e.g., 20"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-3">
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
            Submit Trip Ticket
          </Button>
        </div>
      </form>
    </Form>
  )
}
