"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export interface OnboardingInput {
  first_name: string
  last_name: string
  middle_name?: string
  suffix?: string
  position?: string
  division_id?: string
  // If creating a new division
  new_division?: {
    name: string
    code: string
    region: string
  }
}

export async function getAvailableDivisions(): Promise<
  { id: string; name: string; code: string; region: string }[]
> {
  const adminClient = createAdminClient()
  const { data } = await adminClient
    .schema("platform")
    .from("divisions")
    .select("id, name, code, region")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("name")

  return (data ?? []) as { id: string; name: string; code: string; region: string }[]
}

export async function completeOnboarding(
  input: OnboardingInput
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: "Not authenticated." }

  // Check if profile already exists (prevent double-submit)
  const { data: existing } = await supabase
    .schema("procurements")
    .from("user_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle()

  if (existing) return { error: null } // Already onboarded

  // Use admin client to bypass RLS for profile creation
  const adminClient = createAdminClient()

  let divisionId = input.division_id

  // Create new division if requested
  if (input.new_division && !divisionId) {
    const { data: division, error: divError } = await adminClient
      .schema("platform")
      .from("divisions")
      .insert({
        name: input.new_division.name,
        code: input.new_division.code.toUpperCase(),
        region: input.new_division.region,
        subscription_plan: "basic",
        subscription_status: "active",
        max_users: 50,
        max_schools: 30,
      })
      .select("id")
      .single()

    if (divError) return { error: divError.message }
    divisionId = division.id
  }

  if (!divisionId) return { error: "Please select or create a division." }

  // Create user profile
  const { error: profileError } = await adminClient
    .schema("procurements")
    .from("user_profiles")
    .insert({
      id: user.id,
      division_id: divisionId,
      first_name: input.first_name,
      last_name: input.last_name,
      middle_name: input.middle_name || null,
      suffix: input.suffix || null,
      position: input.position || null,
      is_active: true,
    })

  if (profileError) return { error: profileError.message }

  // Assign division_admin role to the first user in a division
  const { count } = await adminClient
    .schema("procurements")
    .from("user_profiles")
    .select("id", { count: "exact", head: true })
    .eq("division_id", divisionId)

  if (count === 1) {
    // This is the first user — make them division admin
    const { data: adminRole } = await adminClient
      .schema("procurements")
      .from("roles")
      .select("id")
      .eq("name", "division_admin")
      .single()

    if (adminRole) {
      await adminClient
        .schema("procurements")
        .from("user_roles")
        .insert({
          user_id: user.id,
          role_id: adminRole.id,
          division_id: divisionId,
          is_active: true,
        })
    }
  }

  return { error: null }
}
