"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export function usePermissions() {
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    supabase
      .schema("procurements")
      .rpc("get_user_permissions")
      .then(({ data }) => {
        setPermissions((data as string[]) ?? [])
        setLoading(false)
      })
  }, [])

  function can(permission: string): boolean {
    return permissions.includes(permission)
  }

  function canAny(...perms: string[]): boolean {
    return perms.some((p) => permissions.includes(p))
  }

  function canAll(...perms: string[]): boolean {
    return perms.every((p) => permissions.includes(p))
  }

  return { permissions, loading, can, canAny, canAll }
}
