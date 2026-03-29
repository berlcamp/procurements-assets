"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useFiscalYear } from "@/lib/hooks/use-fiscal-year"

interface FiscalYearSelectorProps {
  value?: string | null
  onChange: (fiscalYearId: string | null) => void
  placeholder?: string
  disabled?: boolean
}

export function FiscalYearSelector({
  value,
  onChange,
  placeholder = "Select fiscal year",
  disabled,
}: FiscalYearSelectorProps) {
  const { allYears, loading } = useFiscalYear()

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
        <SelectItem value="none">— {placeholder} —</SelectItem>
        {allYears.map((fy) => (
          <SelectItem key={fy.id} value={fy.id}>
            {fy.year}
            {fy.is_active ? " (Active)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
