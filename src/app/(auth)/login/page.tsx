"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const searchParams = useSearchParams()
  const redirectedFrom = searchParams.get("redirectedFrom")
  const [loading, setLoading] = useState(false)

  async function handleGoogleLogin() {
    setLoading(true)
    const supabase = createClient()

    const callbackUrl = new URL("/auth/callback", window.location.origin)
    if (redirectedFrom) {
      callbackUrl.searchParams.set("redirectedFrom", redirectedFrom)
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl.toString(),
        queryParams: {
          prompt: "select_account",
        },
      },
    })

    if (error) {
      toast.error(error.message)
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full min-h-screen">
      {/* Left — branded panel */}
      <div className="relative hidden w-[58%] flex-col justify-between overflow-hidden bg-[#0f1623] p-12 lg:flex">
        {/* Subtle grid pattern overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />

        {/* Radial glow */}
        <div className="pointer-events-none absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-blue-500/8 blur-[100px]" />

        {/* Top — logo + wordmark */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
            <ShieldIcon className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">
            DepEd PAS
          </span>
        </div>

        {/* Middle — hero copy */}
        <div className="relative space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
              <span className="text-xs font-medium text-blue-300 tracking-wide uppercase">
                RA 12009 Compliant
              </span>
            </div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white">
              Procurement,
              <br />
              Asset &amp; Budget
              <br />
              <span className="text-blue-400">Management</span>
            </h1>
            <p className="max-w-sm text-base text-slate-400 leading-relaxed">
              Unified platform for DepEd divisions to manage procurement
              planning, asset tracking, and budget utilization — end-to-end.
            </p>
          </div>

          {/* Feature highlights */}
          <div className="grid grid-cols-1 gap-3">
            {[
              {
                icon: <DocumentIcon className="h-4 w-4" />,
                label: "PPMP & APP Workflows",
                desc: "Multi-step approval with division oversight",
              },
              {
                icon: <ChartIcon className="h-4 w-4" />,
                label: "Budget Utilization Tracking",
                desc: "Real-time INDICATIVE and FINAL figures",
              },
              {
                icon: <LockIcon className="h-4 w-4" />,
                label: "Role-based Access Control",
                desc: "End user, division, BAC, and admin tiers",
              },
            ].map(({ icon, label, desc }) => (
              <div
                key={label}
                className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3.5"
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400">
                  {icon}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom — footer */}
        <div className="relative flex items-center justify-between border-t border-white/5 pt-6">
          <p className="text-xs text-slate-600">
            Department of Education
          </p>
          <p className="text-xs text-slate-600">
            © {new Date().getFullYear()} DepEd PAS
          </p>
        </div>
      </div>

      {/* Right — login form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background p-8">
        {/* Mobile logo */}
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
            <ShieldIcon className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">DepEd PAS</span>
        </div>

        <div className="w-full max-w-[360px] space-y-8">
          {/* Heading */}
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground">
              Sign in with your DepEd Google account to continue.
            </p>
          </div>

          {/* Login card */}
          <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
            <Button
              className="w-full h-10 gap-2.5 text-sm font-medium"
              variant="outline"
              disabled={loading}
              onClick={handleGoogleLogin}
            >
              <GoogleIcon className="h-4 w-4 shrink-0" />
              {loading ? "Redirecting…" : "Continue with Google"}
            </Button>

            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              Access is restricted to authorized DepEd personnel.
              <br />
              Use your{" "}
              <span className="font-medium text-foreground">@deped.gov.ph</span>{" "}
              account.
            </p>
          </div>

          {/* Help text */}
          <p className="text-center text-xs text-muted-foreground">
            Having trouble signing in?{" "}
            <span className="cursor-pointer font-medium text-primary hover:underline">
              Contact your division ICT coordinator
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── Icons ─────────────────────────────────────────────────────────────── */

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2L4 6v6c0 5.25 3.5 10.15 8 11.35C16.5 22.15 20 17.25 20 12V6l-8-4z"
        fill="currentColor"
        fillOpacity="0.9"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path d="M9 12h6M9 16h6M14 3v4a1 1 0 001 1h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 11V7a4 4 0 118 0v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
