"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Office } from "@/types/database"

interface OfficeSelectorProps {
  value?: string | null
  onChange: (officeId: string | null) => void
  placeholder?: string
  /** If true, includes an "All offices" / "None" option */
  allowClear?: boolean
  /** Filter to specific office types */
  officeTypes?: Array<"division_office" | "school" | "section">
  disabled?: boolean
}

export function OfficeSelector({
  value,
  onChange,
  placeholder = "Select office",
  allowClear = true,
  officeTypes,
  disabled,
}: OfficeSelectorProps) {
  const [offices, setOffices] = useState<Office[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      let query = supabase
        .schema("procurements")
        .from("offices")
        .select("*")
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("name")

      if (officeTypes?.length) {
        query = query.in("office_type", officeTypes)
      }

      const { data } = await query
      setOffices((data ?? []) as Office[])
      setLoading(false)
    }

    load()
  }, [officeTypes?.join(",")])

  return (
    <Select
      value={value ?? "none"}
      onValueChange={(v) => onChange(v === "none" ? null : v)}
      disabled={disabled || loading}
    >
      <SelectTrigger>
        <SelectValue placeholder={loading ? "Loading…" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowClear && (
          <SelectItem value="none">— {placeholder} —</SelectItem>
        )}
        {offices.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
