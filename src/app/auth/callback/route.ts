import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const redirectedFrom = searchParams.get("redirectedFrom")

  if (code) {
    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Check if user has a profile in procurements.user_profiles
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        // Use a direct query to check profile existence
        const { data: profile } = await supabase
          .schema("procurements")
          .from("user_profiles")
          .select("id")
          .eq("id", user.id)
          .maybeSingle()

        if (!profile) {
          // No profile — check for pending join request
          const adminClient = createAdminClient()
          const { data: pendingRequest } = await adminClient
            .schema("procurements")
            .from("division_join_requests")
            .select("id, status")
            .eq("user_id", user.id)
            .eq("status", "pending")
            .maybeSingle()

          if (pendingRequest) {
            return NextResponse.redirect(new URL("/pending-approval", origin))
          }

          // No profile, no pending request → onboarding
          return NextResponse.redirect(new URL("/onboarding", origin))
        }
      }

      const { data: isSuperAdmin } = await supabase
        .schema("platform")
        .rpc("is_super_admin")

      let destination: string
      if (isSuperAdmin) {
        destination = "/platform"
      } else if (redirectedFrom?.startsWith("/dashboard")) {
        destination = redirectedFrom
      } else {
        destination = "/dashboard"
      }

      return NextResponse.redirect(new URL(destination, origin))
    }
  }

  // Exchange failed — send back to login with error hint
  return NextResponse.redirect(new URL("/login?error=auth", origin))
}
