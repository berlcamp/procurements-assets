"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { budgetAdjustmentSchema, type BudgetAdjustmentInput, ADJUSTMENT_TYPE_LABELS } from "@/lib/schemas/budget"
import { createBudgetAdjustment } from "@/lib/actions/budget"
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
import { FundAvailabilityBadge } from "@/components/budget/fund-availability-badge"
import { createClient } from "@/lib/supabase/client"
import type { BudgetAllocationWithDetails } from "@/types/database"

export function AdjustmentForm() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [allocations, setAllocations] = useState<BudgetAllocationWithDetails[]>([])
  const [selectedAlloc, setSelectedAlloc] = useState<BudgetAllocationWithDetails | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<BudgetAdjustmentInput>({
    resolver: zodResolver(budgetAdjustmentSchema),
  })

  useEffect(() => {
    const supabase = createClient()
    supabase
      .schema("procurements")
      .from("budget_allocations")
      .select(`
        *,
        office:offices(id, name, code),
        fund_source:fund_sources(id, name, code),
        account_code:account_codes(id, name, code, expense_class),
        fiscal_year:fiscal_years(id, year, status)
      `)
      .is("deleted_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setAllocations((data ?? []) as BudgetAllocationWithDetails[])
      })
  }, [])

  const allocationItems = useMemo(
    () => Object.fromEntries(allocations.map((a) => [
      a.id,
      `${(a.office as { name: string } | undefined)?.name} — ${(a.account_code as { code: string } | undefined)?.code} (${(a.fiscal_year as { year: number } | undefined)?.year})`,
    ])),
    [allocations]
  )

  const watchedAllocationId = watch("budget_allocation_id")
  useEffect(() => {
    const found = allocations.find((a) => a.id === watchedAllocationId) ?? null
    setSelectedAlloc(found)
  }, [watchedAllocationId, allocations])

  async function onSubmit(values: BudgetAdjustmentInput) {
    setSaving(true)
    const result = await createBudgetAdjustment(values)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Adjustment request submitted for approval.")
    router.push("/dashboard/budget/adjustments")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Budget Allocation */}
      <div className="space-y-2">
        <Label>Budget Allocation *</Label>
        <Select
          onValueChange={(v) => { if (v) setValue("budget_allocation_id", v) }}
          value={watch("budget_allocation_id") ?? ""}
          items={allocationItems}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select allocation to adjust" />
          </SelectTrigger>
          <SelectContent>
            {allocations.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {(a.office as { name: string } | undefined)?.name} — {(a.account_code as { code: string } | undefined)?.code} ({(a.fiscal_year as { year: number } | undefined)?.year})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.budget_allocation_id && (
          <p className="text-xs text-destructive">{errors.budget_allocation_id.message}</p>
        )}
        {selectedAlloc && (
          <div className="mt-1">
            <FundAvailabilityBadge
              availableAmount={
                parseFloat(selectedAlloc.adjusted_amount) - parseFloat(selectedAlloc.obligated_amount)
              }
              adjustedAmount={selectedAlloc.adjusted_amount}
            />
          </div>
        )}
      </div>

      {/* Adjustment Type */}
      <div className="space-y-2">
        <Label>Adjustment Type *</Label>
        <Select
          onValueChange={(v) => { if (v) setValue("adjustment_type", v as BudgetAdjustmentInput["adjustment_type"]) }}
          value={watch("adjustment_type") ?? ""}
          items={ADJUSTMENT_TYPE_LABELS as Record<string, React.ReactNode>}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ADJUSTMENT_TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.adjustment_type && (
          <p className="text-xs text-destructive">{errors.adjustment_type.message}</p>
        )}
      </div>

      {/* Amount */}
      <div className="space-y-2">
        <Label htmlFor="amount">Amount (₱) *</Label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          {...register("amount")}
          className="font-mono"
        />
        {errors.amount && (
          <p className="text-xs text-destructive">{errors.amount.message}</p>
        )}
      </div>

      {/* Justification */}
      <div className="space-y-2">
        <Label htmlFor="justification">Justification *</Label>
        <Textarea
          id="justification"
          placeholder="Provide a detailed justification for this adjustment (min. 10 characters)"
          rows={4}
          {...register("justification")}
        />
        {errors.justification && (
          <p className="text-xs text-destructive">{errors.justification.message}</p>
        )}
      </div>

      {/* Reference Number */}
      <div className="space-y-2">
        <Label htmlFor="reference_number">Reference Number</Label>
        <Input
          id="reference_number"
          placeholder="e.g. DBM-2026-001"
          {...register("reference_number")}
        />
      </div>

      <div className="flex gap-3 pt-1">
        <Button type="submit" disabled={saving}>
          {saving ? "Submitting…" : "Submit for Approval"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/dashboard/budget/adjustments")}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
