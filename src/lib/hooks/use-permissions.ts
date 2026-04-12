"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

export function usePermissions() {
  const [permissions, setPermissions] = useState<string[]>([])
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => {
      const user = data.user
      const superAdmin = user?.user_metadata?.is_super_admin === true
      setIsSuperAdmin(superAdmin)

      if (superAdmin) {
        // Super admin bypasses every gate — fetch all permission codes so the
        // `can`/`canAny`/`canAll` helpers always return true.
        supabase
          .schema("procurements")
          .from("permissions")
          .select("code")
          .then(({ data }: { data: { code: string }[] | null }) => {
            setPermissions((data ?? []).map((p) => p.code))
            setLoading(false)
          })
      } else {
        supabase
          .schema("procurements")
          .rpc("get_user_permissions")
          .then(({ data }: { data: string[] | null }) => {
            setPermissions((data as string[]) ?? [])
            setLoading(false)
          })
      }
    })
  }, [])

  function can(permission: string): boolean {
    if (isSuperAdmin) return true
    return permissions.includes(permission)
  }

  function canAny(...perms: string[]): boolean {
    if (isSuperAdmin) return true
    return perms.some((p) => permissions.includes(p))
  }

  function canAll(...perms: string[]): boolean {
    if (isSuperAdmin) return true
    return perms.every((p) => permissions.includes(p))
  }

  return { permissions, loading, can, canAny, canAll, isSuperAdmin }
}
