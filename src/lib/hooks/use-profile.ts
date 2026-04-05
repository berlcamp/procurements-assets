"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export interface UserRoleSummary {
  role_display_name: string
  office_name: string | null
}

interface ProfileSummary {
  office_name: string | null
  roles: UserRoleSummary[]
}

export function useProfile(): ProfileSummary & { loading: boolean } {
  const [data, setData] = useState<ProfileSummary>({ office_name: null, roles: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const [{ data: profile }, { data: rolesData }] = await Promise.all([
        supabase.schema("procurements").from("user_profiles")
          .select("office:offices!office_id(name)")
          .eq("id", user.id)
          .single(),
        supabase.schema("procurements").from("user_roles")
          .select("role:roles(display_name), office:offices!office_id(name)")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .is("revoked_at", null),
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profileOffice = profile?.office as any
      const office_name = Array.isArray(profileOffice)
        ? profileOffice[0]?.name ?? null
        : profileOffice?.name ?? null

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const roles: UserRoleSummary[] = ((rolesData ?? []) as any[]).map((r) => {
        const role = Array.isArray(r.role) ? r.role[0] : r.role
        const office = Array.isArray(r.office) ? r.office[0] : r.office
        return {
          role_display_name: role?.display_name ?? "Unknown",
          office_name: office?.name ?? null,
        }
      })

      setData({ office_name, roles })
      setLoading(false)
    }

    load()
  }, [])

  return { ...data, loading }
}
