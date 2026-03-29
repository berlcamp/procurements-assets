"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export function useIsSuperAdmin() {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    supabase
      .schema("platform")
      .rpc("is_super_admin")
      .then(({ data }) => {
        setIsSuperAdmin(Boolean(data))
        setLoading(false)
      })
  }, [])

  return { isSuperAdmin, loading }
}
