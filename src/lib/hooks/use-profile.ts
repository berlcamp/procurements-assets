"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export interface UserRoleSummary {
  role_display_name: string
  office_name: string | null
}

interface ProfileSummary {
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  suffix: string | null
  /** Convenience: assembled "First Middle Last, Suffix" or null if no name parts. */
  full_name: string | null
  office_name: string | null
  roles: UserRoleSummary[]
}

const EMPTY: ProfileSummary = {
  first_name: null,
  middle_name: null,
  last_name: null,
  suffix: null,
  full_name: null,
  office_name: null,
  roles: [],
}

function buildFullName(
  first: string | null,
  middle: string | null,
  last: string | null,
  suffix: string | null,
): string | null {
  const parts = [first, middle, last].filter(Boolean).join(" ")
  if (!parts) return null
  return suffix ? `${parts}, ${suffix}` : parts
}

export function useProfile(): ProfileSummary & { loading: boolean } {
  const [data, setData] = useState<ProfileSummary>(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const [{ data: profile }, { data: rolesData }] = await Promise.all([
        supabase.schema("procurements").from("user_profiles")
          .select("first_name, middle_name, last_name, suffix, office:offices!office_id(name)")
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

      const first_name = profile?.first_name ?? null
      const middle_name = profile?.middle_name ?? null
      const last_name = profile?.last_name ?? null
      const suffix = profile?.suffix ?? null

      setData({
        first_name,
        middle_name,
        last_name,
        suffix,
        full_name: buildFullName(first_name, middle_name, last_name, suffix),
        office_name,
        roles,
      })
      setLoading(false)
    }

    load()
  }, [])

  return { ...data, loading }
}
