"use client"

import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  supplierSchema,
  type SupplierInput,
  SUPPLIER_CLASSIFICATION_OPTIONS,
  BUSINESS_TYPE_OPTIONS,
} from "@/lib/schemas/procurement"
import { createSupplier, updateSupplier } from "@/lib/actions/procurement"
import type { Supplier } from "@/types/database"

interface SupplierFormProps {
  defaultValues?: Supplier
}

export function SupplierForm({ defaultValues }: SupplierFormProps) {
  const router = useRouter()
  const isEdit = !!defaultValues

  const form = useForm<SupplierInput>({
    resolver: zodResolver(supplierSchema),
    defaultValues: defaultValues ?? {
      name: "", trade_name: "", tin: "", philgeps_number: "",
      address: "", city: "", province: "", zip_code: "",
      contact_person: "", contact_number: "", email: "", website: "",
      business_type: "", classification: [],
    },
  })

  async function onSubmit(data: SupplierInput) {
    const result = isEdit
      ? await updateSupplier(defaultValues!.id, data)
      : await createSupplier(data)

    if ("error" in result && result.error) {
      toast.error(result.error)
      return
    }

    toast.success(isEdit ? "Supplier updated" : "Supplier added")
    router.push("/dashboard/procurement/suppliers")
    router.refresh()
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

        {/* Business Information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business Information</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Business Name *</FormLabel>
                <FormControl><Input {...field} placeholder="Registered business name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="trade_name" render={({ field }) => (
              <FormItem>
                <FormLabel>Trade Name</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} placeholder="DBA / trade name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="tin" render={({ field }) => (
              <FormItem>
                <FormLabel>TIN *</FormLabel>
                <FormControl><Input {...field} placeholder="000-000-000" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="philgeps_number" render={({ field }) => (
              <FormItem>
                <FormLabel>PhilGEPS Registration No.</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="business_type" render={({ field }) => (
              <FormItem>
                <FormLabel>Business Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value ?? ""}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {BUSINESS_TYPE_OPTIONS.map(opt => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="classification" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Classification</FormLabel>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {SUPPLIER_CLASSIFICATION_OPTIONS.map(opt => (
                    <div key={opt} className="flex items-center gap-2">
                      <Checkbox
                        id={`cls-${opt}`}
                        checked={field.value?.includes(opt)}
                        onCheckedChange={(checked) => {
                          const current = field.value ?? []
                          field.onChange(
                            checked
                              ? [...current, opt]
                              : current.filter(v => v !== opt)
                          )
                        }}
                      />
                      <Label htmlFor={`cls-${opt}`} className="text-sm font-normal">{opt}</Label>
                    </div>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        {/* Address */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="address" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Street Address</FormLabel>
                <FormControl>
                  <Textarea {...field} value={field.value ?? ""} rows={2} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="city" render={({ field }) => (
              <FormItem>
                <FormLabel>City / Municipality</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="province" render={({ field }) => (
              <FormItem>
                <FormLabel>Province</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="zip_code" render={({ field }) => (
              <FormItem>
                <FormLabel>ZIP Code</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        {/* Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="contact_person" render={({ field }) => (
              <FormItem>
                <FormLabel>Contact Person</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="contact_number" render={({ field }) => (
              <FormItem>
                <FormLabel>Contact Number</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} type="email" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="website" render={({ field }) => (
              <FormItem>
                <FormLabel>Website</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} type="url" placeholder="https://" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving..." : (isEdit ? "Update Supplier" : "Save Supplier")}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  )
}
