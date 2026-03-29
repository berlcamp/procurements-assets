"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

interface FiscalYear {
  id: string
  division_id: string
  year: number
  is_active: boolean
  start_date: string | null
  end_date: string | null
  status: string
}

export function useFiscalYear() {
  const [fiscalYear, setFiscalYear] = useState<FiscalYear | null>(null)
  const [allYears, setAllYears] = useState<FiscalYear[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data } = await supabase
        .schema("procurements")
        .from("fiscal_years")
        .select("*")
        .order("year", { ascending: false })

      const years = (data ?? []) as FiscalYear[]
      setAllYears(years)
      setFiscalYear(years.find((y) => y.is_active) ?? years[0] ?? null)
      setLoading(false)
    }

    load()
  }, [])

  return { fiscalYear, allYears, loading }
}
