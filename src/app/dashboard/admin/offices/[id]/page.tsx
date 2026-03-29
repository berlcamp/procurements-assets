"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { officeSchema, type OfficeInput } from "@/lib/schemas/admin"
import { getOfficeById, updateOffice, createOffice, softDeleteOffice } from "@/lib/actions/offices"
import { getOffices } from "@/lib/actions/offices"
import { useDivision } from "@/lib/hooks/use-division"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  CardDescription,
} from "@/components/ui/card"
import { toast } from "sonner"
import type { Office } from "@/types/database"

export default function OfficeDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { divisionId } = useDivision()
  const isNew = params.id === "new"

  const [offices, setOffices] = useState<Office[]>([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<OfficeInput>({
    resolver: zodResolver(officeSchema),
    defaultValues: { office_type: "section" },
  })

  const loadData = useCallback(async () => {
    const [allOffices, office] = await Promise.all([
      getOffices(),
      isNew ? Promise.resolve(null) : getOfficeById(params.id),
    ])

    setOffices(allOffices.filter((o) => o.id !== params.id))

    if (office) {
      reset({
        name: office.name,
        code: office.code,
        office_type: office.office_type,
        parent_office_id: office.parent_office_id ?? undefined,
        address: office.address ?? "",
        contact_number: office.contact_number ?? "",
        email: office.email ?? "",
      })
    }
    setLoading(false)
  }, [isNew, params.id, reset])

  useEffect(() => {
    loadData()
  }, [loadData])

  async function onSubmit(values: OfficeInput) {
    if (!divisionId) {
      toast.error("Division context not loaded")
      return
    }

    setSaving(true)
    const result = isNew
      ? await createOffice({ ...values, division_id: divisionId })
      : await updateOffice(params.id, values)

    if (result.error) {
      toast.error(result.error)
      setSaving(false)
      return
    }

    toast.success(isNew ? "Office created." : "Office updated.")
    router.push("/dashboard/admin/offices")
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to deactivate this office?")) return
    const result = await softDeleteOffice(params.id)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Office deactivated.")
    router.push("/dashboard/admin/offices")
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {isNew ? "Add Office" : "Edit Office"}
        </h1>
        {!isNew && (
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            Deactivate
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Office Details</CardTitle>
          <CardDescription>
            Fill in the office information below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" {...register("name")} />
                {errors.name && (
                  <p className="text-xs text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="code">Code *</Label>
                <Input
                  id="code"
                  {...register("code")}
                  className="uppercase"
                  placeholder="e.g. SDO-MAIN"
                />
                {errors.code && (
                  <p className="text-xs text-destructive">{errors.code.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Office Type *</Label>
              <Select
                value={watch("office_type")}
                onValueChange={(v) =>
                  setValue("office_type", v as OfficeInput["office_type"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="division_office">Division Office</SelectItem>
                  <SelectItem value="school">School</SelectItem>
                  <SelectItem value="section">Section</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Parent Office</Label>
              <Select
                value={watch("parent_office_id") ?? "none"}
                onValueChange={(v) =>
                  setValue("parent_office_id", v === "none" ? null : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="None (top level)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (top level)</SelectItem>
                  {offices.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" {...register("address")} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contact_number">Contact Number</Label>
                <Input id="contact_number" {...register("contact_number")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register("email")} />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : isNew ? "Create Office" : "Save Changes"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/dashboard/admin/offices")}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
