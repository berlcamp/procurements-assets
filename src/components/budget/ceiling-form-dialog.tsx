"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import {
  budgetCeilingSchema,
  type BudgetCeilingInput,
  CEILING_STAGE_LABELS,
  CEILING_STAGE_DESCRIPTIONS,
  CEILING_TIER_LABELS,
} from "@/lib/schemas/budget"
import { createBudgetCeiling, updateBudgetCeiling } from "@/lib/actions/budget"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Form,
  FormControl,
  FormDescription,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { BudgetCeiling } from "@/types/database"

const TIER_NONE = "__none__"

interface FiscalYearOption {
  id: string
  year: number
  is_active: boolean
}

interface CeilingFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fiscal years the user may attach a ceiling to. */
  fiscalYears: FiscalYearOption[]
  /** Pre-selects the fiscal year when creating. */
  defaultFiscalYearId?: string
  /** Present = edit mode. Absent = create mode. */
  ceiling?: BudgetCeiling
  /** Called after a successful create/update so the caller can refetch. */
  onSaved: () => void
}

/** Empty text inputs must reach the action as null, not "" — `reference_number`
 *  is `.trim().min(1).nullable()` and the date columns are DATE, not TEXT. */
function blankToNull(value: string): string | null {
  return value.trim() === "" ? null : value
}

function emptyValues(fiscalYearId: string): BudgetCeilingInput {
  return {
    fiscal_year_id: fiscalYearId,
    stage: "indicative",
    tier: null,
    issuing_authority: "DepEd Regional Office",
    reference_number: null,
    amount: "",
    issued_date: null,
    effective_date: null,
    is_authoritative: true,
    document_url: null,
    remarks: null,
  }
}

/**
 * Create/edit dialog for procurements.budget_ceilings.
 *
 * Validation is `budgetCeilingSchema` verbatim — amounts stay strings the whole
 * way through so NUMERIC(15,2) never round-trips through a JS float.
 */
export function CeilingFormDialog({
  open,
  onOpenChange,
  fiscalYears,
  defaultFiscalYearId,
  ceiling,
  onSaved,
}: CeilingFormDialogProps) {
  const isEdit = Boolean(ceiling)
  const [saving, setSaving] = useState(false)

  const form = useForm<BudgetCeilingInput>({
    // Zod 4 `.default()` makes the resolver's input type diverge from the
    // inferred output type. Same cast the other dialog forms in this repo use.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(budgetCeilingSchema) as any,
    defaultValues: emptyValues(defaultFiscalYearId ?? ""),
  })

  const { reset } = form

  // Re-seed whenever the dialog opens, so create and edit never leak state.
  useEffect(() => {
    if (!open) return
    reset(
      ceiling
        ? {
            fiscal_year_id: ceiling.fiscal_year_id,
            stage: ceiling.stage,
            tier: ceiling.tier,
            issuing_authority: ceiling.issuing_authority,
            reference_number: ceiling.reference_number,
            amount: ceiling.amount,
            issued_date: ceiling.issued_date,
            effective_date: ceiling.effective_date,
            is_authoritative: ceiling.is_authoritative,
            document_url: ceiling.document_url,
            remarks: ceiling.remarks,
          }
        : emptyValues(defaultFiscalYearId ?? "")
    )
  }, [open, ceiling, defaultFiscalYearId, reset])

  async function onSubmit(values: BudgetCeilingInput) {
    setSaving(true)
    const result =
      isEdit && ceiling
        ? await updateBudgetCeiling(ceiling.id, values)
        : await createBudgetCeiling(values)
    setSaving(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success(isEdit ? "Budget ceiling updated." : "Budget ceiling recorded.")
    onOpenChange(false)
    onSaved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Budget Ceiling" : "Record Budget Ceiling"}
          </DialogTitle>
          <DialogDescription>
            The budget authority a procurement plan is prepared against. The
            highest-precedence operative ceiling determines the planning stage
            stamped on PPMP and APP versions.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              {/* Fiscal Year */}
              <FormField
                control={form.control}
                name="fiscal_year_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fiscal Year *</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(v) => {
                        if (v) field.onChange(v)
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select fiscal year" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent
                        alignItemWithTrigger={false}
                        className="w-auto min-w-[var(--anchor-width)]"
                      >
                        {fiscalYears.map((fy) => (
                          <SelectItem key={fy.id} value={fy.id}>
                            FY {fy.year}
                            {fy.is_active ? " (Active)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Stage */}
              <FormField
                control={form.control}
                name="stage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stage *</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(v) => {
                        if (v) field.onChange(v)
                      }}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select stage" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent
                        alignItemWithTrigger={false}
                        className="w-auto min-w-[var(--anchor-width)]"
                      >
                        {Object.entries(CEILING_STAGE_LABELS).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    {field.value && (
                      <FormDescription>
                        {CEILING_STAGE_DESCRIPTIONS[field.value]}
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Issuing Authority */}
              <FormField
                control={form.control}
                name="issuing_authority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Issuing Authority *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        placeholder="e.g., DepEd Regional Office"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Reference Number */}
              <FormField
                control={form.control}
                name="reference_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reference Number</FormLabel>
                    <FormControl>
                      <Input
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(blankToNull(e.target.value))
                        }
                        placeholder="e.g., RO-BC-2026-014"
                        className="font-mono"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Amount */}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ceiling Amount (₱) *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ""}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="font-mono"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Tier */}
              <FormField
                control={form.control}
                name="tier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Budget Tier</FormLabel>
                    <Select
                      value={field.value ?? TIER_NONE}
                      onValueChange={(v) =>
                        field.onChange(!v || v === TIER_NONE ? null : v)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Not tiered" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent
                        alignItemWithTrigger={false}
                        className="w-auto min-w-[var(--anchor-width)]"
                      >
                        <SelectItem value={TIER_NONE}>Not tiered</SelectItem>
                        {Object.entries(CEILING_TIER_LABELS).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      DBM two-tier budgeting. Leave blank if the ceiling is not
                      split.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Issued Date */}
              <FormField
                control={form.control}
                name="issued_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Issued Date</FormLabel>
                    <FormControl>
                      <Input
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        type="date"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(blankToNull(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Effective Date */}
              <FormField
                control={form.control}
                name="effective_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Effective Date</FormLabel>
                    <FormControl>
                      <Input
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        type="date"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(blankToNull(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Document URL */}
            <FormField
              control={form.control}
              name="document_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Document URL</FormLabel>
                  <FormControl>
                    <Input
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(blankToNull(e.target.value))
                      }
                      placeholder="Link to the signed issuance, if any"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Remarks */}
            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks</FormLabel>
                  <FormControl>
                    <Textarea
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      rows={3}
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(blankToNull(e.target.value))
                      }
                      placeholder="Optional notes about this ceiling"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Authoritative */}
            <FormField
              control={form.control}
              name="is_authoritative"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-start gap-3 rounded-md border border-dashed bg-muted/30 px-3 py-2.5">
                    <FormControl>
                      <Checkbox
                        id="is_authoritative"
                        checked={field.value === true}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                        className="mt-0.5"
                      />
                    </FormControl>
                    <div className="space-y-1">
                      <Label htmlFor="is_authoritative" className="font-normal">
                        This is the operative ceiling for the fiscal year and
                        stage
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Only one operative ceiling may exist per fiscal year per
                        stage. Clear this box to keep a superseded issuance on
                        record.
                      </p>
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : isEdit ? "Save Changes" : "Record Ceiling"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
