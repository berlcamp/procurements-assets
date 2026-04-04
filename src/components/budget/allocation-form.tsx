"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { budgetAllocationSchema, type BudgetAllocationInput } from "@/lib/schemas/budget"
import { createBudgetAllocation } from "@/lib/actions/budget"
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
import type { FiscalYear, Office, FundSource, AccountCode } from "@/types/database"

export function AllocationForm() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [offices, setOffices] = useState<Office[]>([])
  const [fundSources, setFundSources] = useState<FundSource[]>([])
  const [accountCodes, setAccountCodes] = useState<AccountCode[]>([])

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<BudgetAllocationInput>({
    resolver: zodResolver(budgetAllocationSchema),
  })

  const fiscalYearItems = useMemo(
    () => Object.fromEntries(fiscalYears.map((fy) => [fy.id, `${fy.year} — ${fy.status}${fy.is_active ? " (Active)" : ""}`])),
    [fiscalYears]
  )

  const officeItems = useMemo(
    () => Object.fromEntries(offices.map((o) => [o.id, `${o.name} (${o.code})`])),
    [offices]
  )

  const fundSourceItems = useMemo(
    () => Object.fromEntries(fundSources.map((fs) => [fs.id, `${fs.name} (${fs.code})`])),
    [fundSources]
  )

  const accountCodeItems = useMemo(
    () => Object.fromEntries(accountCodes.map((ac) => [ac.id, `${ac.code} — ${ac.name} (${ac.expense_class})`])),
    [accountCodes]
  )

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.schema("procurements").from("fiscal_years").select("*").order("year", { ascending: false }),
      supabase.schema("procurements").from("offices").select("id, name, code").is("deleted_at", null).order("name"),
      supabase.schema("procurements").from("fund_sources").select("id, name, code").eq("is_active", true).order("name"),
      supabase.schema("procurements").from("account_codes").select("id, name, code, expense_class").eq("is_active", true).order("code"),
    ]).then(([fy, off, fs, ac]) => {
      setFiscalYears((fy.data ?? []) as FiscalYear[])
      setOffices((off.data ?? []) as Office[])
      setFundSources((fs.data ?? []) as FundSource[])
      setAccountCodes((ac.data ?? []) as AccountCode[])
    })
  }, [])

  async function onSubmit(values: BudgetAllocationInput) {
    setSaving(true)
    const result = await createBudgetAllocation(values)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Budget allocation created.")
    router.push("/dashboard/budget/allocations")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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

      {/* Office */}
      <div className="space-y-2">
        <Label>Office *</Label>
        <Select
          onValueChange={(v) => { if (v) setValue("office_id", v) }}
          value={watch("office_id") ?? ""}
          items={officeItems}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select office" />
          </SelectTrigger>
          <SelectContent>
            {offices.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name} ({o.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.office_id && (
          <p className="text-xs text-destructive">{errors.office_id.message}</p>
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

      {/* Account Code */}
      <div className="space-y-2">
        <Label>Account Code (UACS) *</Label>
        <Select
          onValueChange={(v) => { if (v) setValue("account_code_id", v) }}
          value={watch("account_code_id") ?? ""}
          items={accountCodeItems}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select account code" />
          </SelectTrigger>
          <SelectContent>
            {accountCodes.map((ac) => (
              <SelectItem key={ac.id} value={ac.id}>
                {ac.code} — {ac.name} ({ac.expense_class})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.account_code_id && (
          <p className="text-xs text-destructive">{errors.account_code_id.message}</p>
        )}
      </div>

      {/* Original Amount */}
      <div className="space-y-2">
        <Label htmlFor="original_amount">Original Amount (₱) *</Label>
        <Input
          id="original_amount"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          {...register("original_amount")}
          className="font-mono"
        />
        {errors.original_amount && (
          <p className="text-xs text-destructive">{errors.original_amount.message}</p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="Optional notes about this budget line"
          rows={3}
          {...register("description")}
        />
      </div>

      <div className="flex gap-3 pt-1">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Create Allocation"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/dashboard/budget/allocations")}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
