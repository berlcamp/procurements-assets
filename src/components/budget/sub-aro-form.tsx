"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { subAroSchema, type SubAroInput } from "@/lib/schemas/budget"
import { createSubAro, updateSubAro } from "@/lib/actions/budget"
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
import { createClient } from "@/lib/supabase/client"
import type { FiscalYear, FundSource, SubAroWithDetails } from "@/types/database"

interface SubAroFormProps {
  subAro?: SubAroWithDetails
}

export function SubAroForm({ subAro }: SubAroFormProps = {}) {
  const router = useRouter()
  const isEdit = Boolean(subAro)
  const [saving, setSaving] = useState(false)
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [fundSources, setFundSources] = useState<FundSource[]>([])

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SubAroInput>({
    resolver: zodResolver(subAroSchema),
    defaultValues: subAro
      ? {
          fiscal_year_id: subAro.fiscal_year_id,
          sub_aro_number: subAro.sub_aro_number,
          aro_number: subAro.aro_number ?? "",
          allotment_class: subAro.allotment_class,
          fund_source_id: subAro.fund_source_id,
          releasing_office: subAro.releasing_office ?? "",
          release_date: subAro.release_date ?? "",
          validity_date: subAro.validity_date ?? "",
          purpose: subAro.purpose ?? "",
          total_amount: subAro.total_amount,
          remarks: subAro.remarks ?? "",
        }
      : {
          allotment_class: "current",
        },
  })

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.schema("procurements").from("fiscal_years").select("*").order("year", { ascending: false }),
      supabase.schema("procurements").from("fund_sources").select("id, name, code").eq("is_active", true).order("name"),
    ]).then(([fy, fs]) => {
      setFiscalYears((fy.data ?? []) as FiscalYear[])
      setFundSources((fs.data ?? []) as FundSource[])
    })
  }, [])

  async function onSubmit(values: SubAroInput) {
    setSaving(true)
    if (isEdit && subAro) {
      const result = await updateSubAro(subAro.id, values)
      setSaving(false)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Sub-ARO updated successfully")
      router.push(`/dashboard/budget/sub-aros/${subAro.id}`)
      router.refresh()
      return
    }
    const result = await createSubAro(values)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Sub-ARO created successfully")
    router.push(`/dashboard/budget/sub-aros/${result.id}`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        {/* Sub-ARO Number */}
        <div className="space-y-2">
          <Label htmlFor="sub_aro_number">Sub-ARO Number *</Label>
          <Input
            id="sub_aro_number"
            placeholder="e.g. Sub-ARO-2026-001"
            {...register("sub_aro_number")}
          />
          {errors.sub_aro_number && (
            <p className="text-xs text-destructive">{errors.sub_aro_number.message}</p>
          )}
        </div>

        {/* Parent ARO Number */}
        <div className="space-y-2">
          <Label htmlFor="aro_number">Parent ARO Number</Label>
          <Input
            id="aro_number"
            placeholder="e.g. ARO-RO4A-2026-001"
            {...register("aro_number")}
          />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Fiscal Year */}
        <div className="space-y-2">
          <Label>Fiscal Year *</Label>
          <Select
            onValueChange={(v) => { if (v) setValue("fiscal_year_id", v) }}
            value={watch("fiscal_year_id") ?? ""}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select fiscal year" />
            </SelectTrigger>
            <SelectContent>
              {fiscalYears.map((fy) => (
                <SelectItem key={fy.id} value={fy.id}>
                  {fy.year} — {fy.status}{fy.is_active ? " (Active)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.fiscal_year_id && (
            <p className="text-xs text-destructive">{errors.fiscal_year_id.message}</p>
          )}
        </div>

        {/* Fund Source */}
        <div className="space-y-2">
          <Label>Fund Source *</Label>
          <Select
            onValueChange={(v) => { if (v) setValue("fund_source_id", v) }}
            value={watch("fund_source_id") ?? ""}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select fund source" />
            </SelectTrigger>
            <SelectContent>
              {fundSources.map((fs) => (
                <SelectItem key={fs.id} value={fs.id}>
                  {fs.name} ({fs.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.fund_source_id && (
            <p className="text-xs text-destructive">{errors.fund_source_id.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Allotment Class */}
        <div className="space-y-2">
          <Label>Allotment Class *</Label>
          <Select
            onValueChange={(v) => { if (v) setValue("allotment_class", v as "current" | "continuing") }}
            value={watch("allotment_class") ?? "current"}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Current Appropriation</SelectItem>
              <SelectItem value="continuing">Continuing Appropriation</SelectItem>
            </SelectContent>
          </Select>
          {errors.allotment_class && (
            <p className="text-xs text-destructive">{errors.allotment_class.message}</p>
          )}
        </div>

        {/* Total Amount */}
        <div className="space-y-2">
          <Label htmlFor="total_amount">Total Amount (₱) *</Label>
          <Input
            id="total_amount"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            {...register("total_amount")}
            className="font-mono"
          />
          {errors.total_amount && (
            <p className="text-xs text-destructive">{errors.total_amount.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Releasing Office */}
        <div className="space-y-2">
          <Label htmlFor="releasing_office">Releasing Office</Label>
          <Input
            id="releasing_office"
            placeholder="e.g. DepEd Region IV-A"
            {...register("releasing_office")}
          />
        </div>

        {/* Release Date */}
        <div className="space-y-2">
          <Label htmlFor="release_date">Release Date</Label>
          <Input
            id="release_date"
            type="date"
            {...register("release_date")}
          />
        </div>
      </div>

      {/* Validity Date */}
      <div className="space-y-2 sm:w-1/2">
        <Label htmlFor="validity_date">Validity Date</Label>
        <Input
          id="validity_date"
          type="date"
          {...register("validity_date")}
        />
      </div>

      {/* Purpose */}
      <div className="space-y-2">
        <Label htmlFor="purpose">Purpose / Description</Label>
        <Textarea
          id="purpose"
          placeholder="Purpose of this allotment release..."
          rows={3}
          {...register("purpose")}
        />
      </div>

      {/* Remarks */}
      <div className="space-y-2">
        <Label htmlFor="remarks">Remarks</Label>
        <Textarea
          id="remarks"
          placeholder="Additional notes..."
          rows={2}
          {...register("remarks")}
        />
      </div>

      <div className="flex gap-3 pt-1">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Sub-ARO"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            router.push(
              isEdit && subAro
                ? `/dashboard/budget/sub-aros/${subAro.id}`
                : "/dashboard/budget/sub-aros"
            )
          }
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
