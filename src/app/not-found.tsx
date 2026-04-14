import Link from "next/link";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0f1623] px-6">
      {/* Background effects */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full bg-blue-600/8 blur-[120px]" />
      <div className="pointer-events-none absolute -right-20 -bottom-20 h-[400px] w-[400px] rounded-full bg-blue-500/6 blur-[100px]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative z-10 flex flex-col items-center text-center">
        {/* Large 404 */}
        <div className="relative mb-6 select-none">
          <span className="text-[10rem] font-black leading-none tracking-tighter text-white/[0.04] sm:text-[14rem]">
            404
          </span>
          <span className="absolute inset-0 flex items-center justify-center text-[10rem] font-black leading-none tracking-tighter text-transparent bg-gradient-to-b from-blue-400 to-blue-600 bg-clip-text sm:text-[14rem]">
            404
          </span>
        </div>

        {/* Message */}
        <div className="mb-8 space-y-3">
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Page not found
          </h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-400">
            The page you&apos;re looking for doesn&apos;t exist or has been
            moved. Check the URL or head back to the dashboard.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-6 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1623]"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back to Dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center rounded-md border border-white/10 bg-white/5 px-6 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1623]"
          >
            Go to Login
          </Link>
        </div>

        {/* Branding */}
        <div className="mt-16 flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600/80">
            <svg
              className="h-4 w-4 text-white"
              viewBox="0 0 24 24"
              fill="none"
            >
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
          </div>
          <span className="text-sm font-semibold tracking-tight text-slate-500">
            PABMS
          </span>
        </div>
      </div>
    </div>
  );
}
