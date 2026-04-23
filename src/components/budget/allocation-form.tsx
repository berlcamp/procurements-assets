"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { budgetAllocationSchema, type BudgetAllocationInput } from "@/lib/schemas/budget"
import {
  createBudgetAllocation,
  updateBudgetAllocation,
  getActiveSubAros,
  getActiveSaros,
} from "@/lib/actions/budget"
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
import type {
  FiscalYear,
  Office,
  FundSource,
  AccountCode,
  SubAroWithDetails,
  SaroWithDetails,
  BudgetAllocationWithDetails,
} from "@/types/database"

interface AllocationFormProps {
  allocation?: BudgetAllocationWithDetails
}

export function AllocationForm({ allocation }: AllocationFormProps = {}) {
  const router = useRouter()
  const isEdit = Boolean(allocation)
  const [saving, setSaving] = useState(false)
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [offices, setOffices] = useState<Office[]>([])
  const [fundSources, setFundSources] = useState<FundSource[]>([])
  const [accountCodes, setAccountCodes] = useState<AccountCode[]>([])
  const [subAros, setSubAros] = useState<SubAroWithDetails[]>([])
  const [saros, setSaros] = useState<SaroWithDetails[]>([])

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<BudgetAllocationInput>({
    resolver: zodResolver(budgetAllocationSchema),
    defaultValues: allocation
      ? {
          fiscal_year_id: allocation.fiscal_year_id,
          office_id: allocation.office_id,
          fund_source_id: allocation.fund_source_id,
          account_code_id: allocation.account_code_id,
          sub_aro_id: allocation.sub_aro_id ?? null,
          saro_id: allocation.saro_id ?? null,
          original_amount: allocation.original_amount,
          description: allocation.description ?? "",
        }
      : undefined,
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

  const fundingAuthorityItems = useMemo(() => {
    const entries: Record<string, string> = { __none__: "No Funding Authority" }
    for (const sa of subAros) {
      const label = `[Sub-ARO] ${sa.sub_aro_number}${sa.aro_number ? ` (${sa.aro_number})` : ""}`
      entries[`sub_aro:${sa.id}`] = label
    }
    for (const s of saros) {
      const label = `[SARO] ${s.saro_number}${s.program ? ` — ${s.program}` : ""}`
      entries[`saro:${s.id}`] = label
    }
    return entries
  }, [subAros, saros])

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.schema("procurements").from("fiscal_years").select("*").order("year", { ascending: false }),
      supabase.schema("procurements").from("offices").select("id, name, code").is("deleted_at", null).order("name"),
      supabase.schema("procurements").from("fund_sources").select("id, name, code").eq("is_active", true).order("name"),
      supabase.schema("procurements").from("account_codes").select("id, name, code, expense_class").eq("is_active", true).order("code"),
      getActiveSubAros(),
      getActiveSaros(),
    ]).then(([fy, off, fs, ac, sa, saro]) => {
      if (fy.error) console.error("AllocationForm fiscal_years error:", fy.error)
      if (off.error) console.error("AllocationForm offices error:", off.error)
      if (fs.error) console.error("AllocationForm fund_sources error:", fs.error)
      if (ac.error) console.error("AllocationForm account_codes error:", ac.error)
      setFiscalYears((fy.data ?? []) as FiscalYear[])
      setOffices((off.data ?? []) as Office[])
      setFundSources((fs.data ?? []) as FundSource[])
      setAccountCodes((ac.data ?? []) as AccountCode[])
      setSubAros(sa)
      setSaros(saro)
    })
  }, [])

  async function onSubmit(values: BudgetAllocationInput) {
    setSaving(true)
    if (isEdit && allocation) {
      const result = await updateBudgetAllocation(allocation.id, values)
      setSaving(false)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Budget allocation updated.")
      router.push(`/dashboard/budget/allocations/${allocation.id}`)
      router.refresh()
      return
    }
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
          <SelectContent
            alignItemWithTrigger={false}
            className="w-auto min-w-[var(--anchor-width)] max-w-[min(calc(100vw-2rem),48rem)]"
          >
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
          <SelectContent
            alignItemWithTrigger={false}
            className="w-auto min-w-[var(--anchor-width)] max-w-[min(calc(100vw-2rem),48rem)]"
          >
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
          <SelectContent
            alignItemWithTrigger={false}
            className="w-auto min-w-[var(--anchor-width)] max-w-[min(calc(100vw-2rem),48rem)]"
          >
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
          <SelectContent
            alignItemWithTrigger={false}
            className="w-auto min-w-[var(--anchor-width)] max-w-[min(calc(100vw-2rem),48rem)]"
          >
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

      {/* Funding Authority (Sub-ARO or SARO, optional) */}
      <div className="space-y-2">
        <Label>Funding Authority (Sub-ARO / SARO)</Label>
        <Select
          onValueChange={(v) => {
            if (!v || v === "__none__") {
              setValue("sub_aro_id", null)
              setValue("saro_id", null)
            } else if (v.startsWith("sub_aro:")) {
              setValue("sub_aro_id", v.replace("sub_aro:", ""))
              setValue("saro_id", null)
            } else if (v.startsWith("saro:")) {
              setValue("saro_id", v.replace("saro:", ""))
              setValue("sub_aro_id", null)
            }
          }}
          value={
            watch("sub_aro_id") ? `sub_aro:${watch("sub_aro_id")}` :
            watch("saro_id") ? `saro:${watch("saro_id")}` :
            "__none__"
          }
          items={fundingAuthorityItems}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select funding authority (optional)" />
          </SelectTrigger>
          <SelectContent
            alignItemWithTrigger={false}
            className="w-auto min-w-[var(--anchor-width)] max-w-[min(calc(100vw-2rem),48rem)]"
          >
            <SelectItem value="__none__">No Funding Authority</SelectItem>
            {subAros.length > 0 && (
              <>
                <SelectItem value="__sub_aro_header__" disabled className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Sub-AROs
                </SelectItem>
                {subAros.map((sa) => {
                  const remaining = parseFloat(sa.total_amount) - parseFloat(sa.allocated_amount)
                  return (
                    <SelectItem key={`sub_aro:${sa.id}`} value={`sub_aro:${sa.id}`}>
                      [Sub-ARO] {sa.sub_aro_number}
                      {sa.aro_number ? ` (${sa.aro_number})` : ""}
                      {" — ₱"}
                      {remaining.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                      {" available"}
                    </SelectItem>
                  )
                })}
              </>
            )}
            {saros.length > 0 && (
              <>
                <SelectItem value="__saro_header__" disabled className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  SAROs
                </SelectItem>
                {saros.map((s) => {
                  const remaining = parseFloat(s.total_amount) - parseFloat(s.allocated_amount)
                  return (
                    <SelectItem key={`saro:${s.id}`} value={`saro:${s.id}`}>
                      [SARO] {s.saro_number}
                      {s.program ? ` — ${s.program}` : ""}
                      {" — ₱"}
                      {remaining.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                      {" available"}
                    </SelectItem>
                  )
                })}
              </>
            )}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Link this allocation to a Sub-ARO or SARO for fund authority tracking.
        </p>
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
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Allocation"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            router.push(
              isEdit && allocation
                ? `/dashboard/budget/allocations/${allocation.id}`
                : "/dashboard/budget/allocations"
            )
          }
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
