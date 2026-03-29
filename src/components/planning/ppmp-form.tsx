"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ppmpHeaderSchema, type PpmpHeaderInput } from "@/lib/schemas/ppmp"
import { createPpmp } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import type { FiscalYear, Office } from "@/types/database"

export function PpmpForm() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [offices, setOffices] = useState<Office[]>([])

  const {
    handleSubmit, setValue, watch,
    formState: { errors },
  } = useForm<PpmpHeaderInput>({
    resolver: zodResolver(ppmpHeaderSchema),
  })

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.schema("procurements").from("fiscal_years").select("*").order("year", { ascending: false }),
      supabase.schema("procurements").from("offices").select("id, name, code, office_type").is("deleted_at", null).order("name"),
    ]).then(([fy, off]) => {
      setFiscalYears((fy.data ?? []) as FiscalYear[])
      setOffices((off.data ?? []) as Office[])
    })
  }, [])

  async function onSubmit(values: PpmpHeaderInput) {
    setSaving(true)
    const result = await createPpmp(values)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("PPMP created.")
    router.push(`/dashboard/planning/ppmp/${result.id}/edit`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="space-y-2">
        <Label>Office *</Label>
        <Select onValueChange={(v) => { if (v) setValue("office_id", v) }} value={watch("office_id") ?? ""}>
          <SelectTrigger>
            <SelectValue placeholder="Select office" />
          </SelectTrigger>
          <SelectContent>
            {offices.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.name} ({o.code})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.office_id && <p className="text-xs text-destructive">{errors.office_id.message}</p>}
      </div>

      <div className="space-y-2">
        <Label>Fiscal Year *</Label>
        <Select onValueChange={(v) => { if (v) setValue("fiscal_year_id", v) }} value={watch("fiscal_year_id") ?? ""}>
          <SelectTrigger>
            <SelectValue placeholder="Select fiscal year" />
          </SelectTrigger>
          <SelectContent>
            {fiscalYears.map((fy) => (
              <SelectItem key={fy.id} value={fy.id}>
                FY {fy.year}{fy.is_active ? " (Active)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.fiscal_year_id && <p className="text-xs text-destructive">{errors.fiscal_year_id.message}</p>}
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create PPMP"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
