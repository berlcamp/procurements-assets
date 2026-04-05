import { NextResponse, type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"
import { createServerClient } from "@supabase/ssr"

function makeSupabase(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {},
      },
    }
  )
}

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  // Let the OAuth callback handle itself — no redirect logic needed
  if (pathname.startsWith("/auth/callback")) {
    return supabaseResponse
  }

  const isSuperAdmin = user?.user_metadata?.is_super_admin === true

  // Redirect authenticated users away from auth pages
  if (pathname.startsWith("/login") && user) {
    const destination = isSuperAdmin ? "/platform" : "/dashboard"
    return NextResponse.redirect(new URL(destination, request.url))
  }

  // Protect routes — redirect unauthenticated users to login
  const isProtectedRoute =
    pathname.startsWith("/dashboard") || pathname.startsWith("/platform")

  if (isProtectedRoute && !user) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("redirectedFrom", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Block Super Admins from /dashboard and non-super-admins from /platform
  if (user && pathname.startsWith("/platform") && !isSuperAdmin) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  // Guard /dashboard: user must have a user_profile record
  if (user && pathname.startsWith("/dashboard") && !isSuperAdmin) {
    const supabase = makeSupabase(request)

    const { data: profile } = await supabase
      .schema("procurements")
      .from("user_profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle()

    if (!profile) {
      // Check if they have a pending join request
      const { data: pendingRequest } = await supabase
        .schema("procurements")
        .from("division_join_requests")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .maybeSingle()

      const destination = pendingRequest ? "/pending-approval" : "/onboarding"
      return NextResponse.redirect(new URL(destination, request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
