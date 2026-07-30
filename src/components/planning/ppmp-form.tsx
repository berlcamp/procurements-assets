"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ppmpHeaderSchema, type PpmpHeaderInput } from "@/lib/schemas/ppmp"
import { createPpmp } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import type { FiscalYear, Office } from "@/types/database"
import { BuildingIcon, CalendarIcon, ArrowRightIcon } from "lucide-react"

/** An office + fiscal year pair that already has a non-cancelled PPMP. */
type TakenSlot = { office_id: string; fiscal_year_id: string; status: string }

export function PpmpForm() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [offices, setOffices] = useState<Office[]>([])
  const [taken, setTaken] = useState<TakenSlot[]>([])

  const {
    handleSubmit, setValue, watch,
    formState: { errors },
  } = useForm<PpmpHeaderInput>({
    resolver: zodResolver(ppmpHeaderSchema),
  })

  const selectedOfficeId = watch("office_id")
  const selectedFiscalYearId = watch("fiscal_year_id")

  const officeItems = useMemo(
    () => Object.fromEntries(offices.map((o) => [o.id, `${o.name} (${o.code})`])),
    [offices]
  )

  const fiscalYearItems = useMemo(
    () => Object.fromEntries(fiscalYears.map((fy) => [fy.id, `FY ${fy.year}${fy.is_active ? " (Active)" : ""}`])),
    [fiscalYears]
  )

  // Offices that already have a PPMP for the selected fiscal year — only one
  // PPMP may exist per office per year, so these cannot be chosen.
  const takenOfficeIds = useMemo(
    () => new Set(
      taken
        .filter((t) => t.fiscal_year_id === selectedFiscalYearId)
        .map((t) => t.office_id)
    ),
    [taken, selectedFiscalYearId]
  )

  const selectedYear = fiscalYears.find((fy) => fy.id === selectedFiscalYearId)?.year
  const selectedOfficeTaken = !!selectedOfficeId && takenOfficeIds.has(selectedOfficeId)
  const allOfficesTaken = offices.length > 0 && offices.every((o) => takenOfficeIds.has(o.id))

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.schema("procurements").from("fiscal_years").select("*").order("year", { ascending: false }),
      supabase.schema("procurements").from("offices").select("id, name, code, office_type").is("deleted_at", null).order("name"),
      // RLS scopes this to the current division. Unlike the PPMP list views it is
      // not filtered by creator or status, so it also covers other users' drafts.
      supabase.schema("procurements").from("ppmps").select("office_id, fiscal_year_id, status").neq("status", "cancelled"),
    ]).then(([fy, off, existing]) => {
      const years = (fy.data ?? []) as FiscalYear[]
      setFiscalYears(years)
      setOffices((off.data ?? []) as Office[])
      setTaken((existing.data ?? []) as TakenSlot[])
      // Auto-select the active fiscal year
      const activeFy = years.find((y) => y.is_active)
      if (activeFy) setValue("fiscal_year_id", activeFy.id)
      setLoading(false)
    })
  }, [setValue])

  async function onSubmit(values: PpmpHeaderInput) {
    setSaving(true)
    const result = await createPpmp(values)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("PPMP created — now add your procurement projects.")
    router.push(`/dashboard/planning/ppmp/${result.id}/edit`)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Office */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          <BuildingIcon className="h-3.5 w-3.5 text-muted-foreground" />
          Office
          <span className="text-destructive">*</span>
        </Label>
        <Select
          onValueChange={(v) => { if (v) setValue("office_id", v) }}
          value={watch("office_id") ?? ""}
          items={officeItems}
        >
          <SelectTrigger className={errors.office_id ? "border-destructive ring-destructive/20" : ""}>
            <SelectValue placeholder="Select the requesting office…" />
          </SelectTrigger>
          <SelectContent>
            {offices.map((o) => {
              const isTaken = takenOfficeIds.has(o.id)
              return (
                <SelectItem key={o.id} value={o.id} disabled={isTaken}>
                  <span className="font-medium">{o.name}</span>
                  <span className="ml-1.5 text-muted-foreground text-xs">({o.code})</span>
                  {isTaken && (
                    <span className="ml-1.5 text-muted-foreground text-xs">
                      — PPMP already exists
                    </span>
                  )}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        {errors.office_id ? (
          <p className="text-xs text-destructive">{errors.office_id.message}</p>
        ) : selectedOfficeTaken ? (
          <p className="text-xs text-destructive">
            This office already has a{selectedYear ? ` FY ${selectedYear}` : ""} PPMP.
            Open the existing one to edit or amend it.
          </p>
        ) : allOfficesTaken ? (
          <p className="text-xs text-destructive">
            Every office already has a{selectedYear ? ` FY ${selectedYear}` : ""} PPMP.
            Choose a different fiscal year.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">The office submitting this PPMP.</p>
        )}
      </div>

      {/* Fiscal Year */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          Fiscal Year
          <span className="text-destructive">*</span>
        </Label>
        <Select
          onValueChange={(v) => { if (v) setValue("fiscal_year_id", v) }}
          value={watch("fiscal_year_id") ?? ""}
          items={fiscalYearItems}
        >
          <SelectTrigger className={errors.fiscal_year_id ? "border-destructive ring-destructive/20" : ""}>
            <SelectValue placeholder="Select fiscal year…" />
          </SelectTrigger>
          <SelectContent>
            {fiscalYears.map((fy) => (
              <SelectItem key={fy.id} value={fy.id}>
                <span className="font-medium">FY {fy.year}</span>
                {fy.is_active && (
                  <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary uppercase tracking-wide">
                    Active
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.fiscal_year_id
          ? <p className="text-xs text-destructive">{errors.fiscal_year_id.message}</p>
          : <p className="text-xs text-muted-foreground">The planning year for this PPMP. The active year is pre-selected.</p>
        }
      </div>

      {/* Divider */}
      <div className="border-t" />

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving || selectedOfficeTaken} className="gap-1.5">
          {saving ? "Creating…" : (
            <>
              Continue to Projects
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </>
          )}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
