"use client"

import { use, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { getDivisionById, updateDivision } from "@/lib/actions/divisions"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useState } from "react"
import type { Division } from "@/types/database"

const REGIONS = [
  "NCR",
  "CAR",
  "Region I",
  "Region II",
  "Region III",
  "Region IV-A",
  "Region IV-B",
  "Region V",
  "Region VI",
  "Region VII",
  "Region VIII",
  "Region IX",
  "Region X",
  "Region XI",
  "Region XII",
  "Region XIII",
  "BARMM",
  "CARAGA",
]

const formSchema = z.object({
  name: z.string().min(1, "Division name is required"),
  code: z.string().min(1, "Division code is required"),
  region: z.string().min(1, "Region is required"),
  address: z.string().optional(),
  contact_number: z.string().optional(),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
  subscription_plan: z.string().min(1),
  max_users: z.string().min(1),
  max_schools: z.string().min(1),
})

type FormValues = z.infer<typeof formSchema>

export default function DivisionSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [division, setDivision] = useState<Division | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      code: "",
      region: "",
      address: "",
      contact_number: "",
      email: "",
      subscription_plan: "basic",
      max_users: "50",
      max_schools: "30",
    },
  })

  useEffect(() => {
    getDivisionById(id).then((div) => {
      if (!div) {
        setLoadError("Division not found.")
        return
      }
      setDivision(div)
      form.reset({
        name: div.name,
        code: div.code,
        region: div.region,
        address: div.address ?? "",
        contact_number: div.contact_number ?? "",
        email: div.email ?? "",
        subscription_plan: div.subscription_plan,
        max_users: String(div.max_users),
        max_schools: String(div.max_schools),
      })
    })
  }, [id, form])

  const isSubmitting = form.formState.isSubmitting

  async function onSubmit(values: FormValues) {
    const { error } = await updateDivision(id, {
      name: values.name,
      code: values.code.toUpperCase(),
      region: values.region,
      address: values.address || null,
      contact_number: values.contact_number || null,
      email: values.email || null,
      subscription_plan: values.subscription_plan,
      max_users: parseInt(values.max_users, 10),
      max_schools: parseInt(values.max_schools, 10),
    })

    if (error) {
      toast.error("Failed to update division", { description: error })
      return
    }

    toast.success("Division updated successfully")
    router.push(`/platform/divisions/${id}`)
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <p className="text-red-600">{loadError}</p>
        <Button variant="outline" onClick={() => router.back()}>
          Go Back
        </Button>
      </div>
    )
  }

  if (!division) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Loading division...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Division Settings</h1>
        <p className="text-muted-foreground">
          Update information for {division.name}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Division Information</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Division Name *</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Division Code *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          onChange={(e) =>
                            field.onChange(e.target.value.toUpperCase())
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="region"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Region *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        items={Object.fromEntries(REGIONS.map((r) => [r, r]))}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select region" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {REGIONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
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
                  name="address"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Address</FormLabel>
                      <FormControl>
                        <Textarea rows={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contact_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Number</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="subscription_plan"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subscription Plan</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        items={{ basic: "Basic", standard: "Standard", premium: "Premium" }}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select plan" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="basic">Basic</SelectItem>
                          <SelectItem value="standard">Standard</SelectItem>
                          <SelectItem value="premium">Premium</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="max_users"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Users</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="max_schools"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Schools</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
