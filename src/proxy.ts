import { NextResponse, type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"
import { createServerClient } from "@supabase/ssr"

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  // Let the OAuth callback handle itself — no redirect logic needed
  if (pathname.startsWith("/auth/callback")) {
    return supabaseResponse
  }

  const isAuthRoute = pathname.startsWith("/login")

  // Redirect authenticated users away from auth pages
  if (isAuthRoute && user) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: () => {},
        },
      }
    )

    // Route Super Admin to /platform, others to /dashboard
    const { data: isSuperAdmin } = await supabase
      .schema("platform")
      .rpc("is_super_admin")
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

  // Block Super Admins from the division dashboard (and vice versa) — best-effort
  if (user && pathname.startsWith("/platform")) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: () => {},
        },
      }
    )
    const { data: isSuperAdmin } = await supabase
      .schema("platform")
      .rpc("is_super_admin")
    if (!isSuperAdmin) {
      return NextResponse.redirect(new URL("/dashboard", request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
