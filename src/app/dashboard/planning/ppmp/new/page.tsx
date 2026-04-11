import Link from "next/link"
import { PpmpForm } from "@/components/planning/ppmp-form"
import { Forbidden } from "@/components/shared/forbidden"
import { getUserPermissions } from "@/lib/actions/roles"
import { ChevronRightIcon, ClipboardListIcon } from "lucide-react"

export default async function NewPpmpPage() {
  const permissions = await getUserPermissions()
  if (!permissions.includes("ppmp.create") && !permissions.includes("ppmp.edit")) {
    return (
      <Forbidden
        message="You don't have permission to create PPMPs. Only roles with ppmp.create (e.g., End User, Division Admin) can access this page."
        backHref="/dashboard/planning/ppmp"
        backLabel="Back to PPMP list"
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/dashboard/planning/ppmp" className="hover:text-foreground transition-colors">
          PPMP
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-foreground font-medium">New PPMP</span>
      </nav>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left: Form */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border bg-card overflow-hidden ring-1 ring-foreground/10">
            <div className="flex items-start gap-3 border-b px-6 py-5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <ClipboardListIcon className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <h1 className="font-heading text-base font-semibold leading-snug">
                  Create New PPMP
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Select the office and fiscal year to get started.
                  You'll add procurement projects in the next step.
                </p>
              </div>
            </div>
            <div className="px-6 py-6">
              <PpmpForm />
            </div>
          </div>
        </div>

        {/* Right: What happens next */}
        <div className="space-y-4">
          <div className="rounded-xl border bg-card ring-1 ring-foreground/10 overflow-hidden">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-medium">What happens next?</p>
            </div>
            <div className="px-4 py-4">
              <ol className="space-y-4">
                {[
                  {
                    step: "1",
                    title: "Set office & fiscal year",
                    description: "Identify the requesting office and the planning year for this PPMP.",
                    active: true,
                  },
                  {
                    step: "2",
                    title: "Add procurement projects",
                    description: "Define your procurement needs — projects, lots, and line items aligned to the GPPB format.",
                    active: false,
                  },
                  {
                    step: "3",
                    title: "Submit for review",
                    description: "Submit to the Section Chief, then Budget Officer for certification and HOPE approval.",
                    active: false,
                  },
                ].map(({ step, title, description, active }) => (
                  <li key={step} className="flex gap-3">
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {step}
                    </div>
                    <div className="space-y-0.5 pt-0.5">
                      <p className={`text-sm font-medium leading-snug ${active ? "" : "text-muted-foreground"}`}>
                        {title}
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="rounded-xl border bg-muted/40 px-4 py-4 text-sm text-muted-foreground leading-relaxed">
            <p className="font-medium text-foreground text-xs uppercase tracking-wide mb-1.5">Note</p>
            One PPMP per office per fiscal year. If a PPMP already exists for the selected
            combination, you'll see a validation error on submit.
          </div>
        </div>
      </div>
    </div>
  )
}
