"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Office } from "@/types/database"

export function useOffice() {
  const [office, setOffice] = useState<Office | null>(null)
  const [officeId, setOfficeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data: profile } = await supabase
        .schema("procurements")
        .from("user_profiles")
        .select("office_id")
        .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
        .single()

      const id = profile?.office_id ?? null
      setOfficeId(id)

      if (id) {
        const { data } = await supabase
          .schema("procurements")
          .from("offices")
          .select("*")
          .eq("id", id)
          .single()
        setOffice(data as Office | null)
      }
      setLoading(false)
    }

    load()
  }, [])

  return { office, officeId, loading }
}
