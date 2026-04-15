"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { saroSchema, type SaroInput } from "@/lib/schemas/budget"
import { createSaro } from "@/lib/actions/budget"
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
import type { FiscalYear, FundSource } from "@/types/database"

export function SaroForm() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [fundSources, setFundSources] = useState<FundSource[]>([])

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SaroInput>({
    resolver: zodResolver(saroSchema),
    defaultValues: {
      allotment_class: "current",
    },
  })

  const fiscalYearItems = useMemo(
    () => Object.fromEntries(fiscalYears.map((fy) => [fy.id, `${fy.year} — ${fy.status}${fy.is_active ? " (Active)" : ""}`])),
    [fiscalYears]
  )

  const fundSourceItems = useMemo(
    () => Object.fromEntries(fundSources.map((fs) => [fs.id, `${fs.name} (${fs.code})`])),
    [fundSources]
  )

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

  async function onSubmit(values: SaroInput) {
    setSaving(true)
    const result = await createSaro(values)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("SARO created successfully")
    router.push(`/dashboard/budget/saros/${result.id}`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        {/* SARO Number */}
        <div className="space-y-2">
          <Label htmlFor="saro_number">SARO Number *</Label>
          <Input
            id="saro_number"
            placeholder="e.g. SARO-BMB-2026-001"
            {...register("saro_number")}
          />
          {errors.saro_number && (
            <p className="text-xs text-destructive">{errors.saro_number.message}</p>
          )}
        </div>

        {/* DBM Reference Number */}
        <div className="space-y-2">
          <Label htmlFor="reference_number">DBM Reference / Control Number</Label>
          <Input
            id="reference_number"
            placeholder="e.g. DBM-2026-XXXXX"
            {...register("reference_number")}
          />
        </div>
      </div>

      {/* Program / Project */}
      <div className="space-y-2">
        <Label htmlFor="program">Program / Project Name</Label>
        <Input
          id="program"
          placeholder="e.g. Calamity Fund, GASTPE, SBM Grant"
          {...register("program")}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Fiscal Year */}
        <div className="space-y-2">
          <Label>Fiscal Year *</Label>
          <Select
            onValueChange={(v) => { if (v) setValue("fiscal_year_id", v) }}
            value={watch("fiscal_year_id") ?? ""}
            items={fiscalYearItems}
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
            items={fundSourceItems}
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
            placeholder="e.g. Department of Budget and Management"
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
          placeholder="Purpose of this special allotment release..."
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
          {saving ? "Saving..." : "Create SARO"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/dashboard/budget/saros")}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
