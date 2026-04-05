import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { getPpmpById, getCurrentPpmpVersion, getPpmpProjects } from "@/lib/actions/ppmp"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { PpmpEditClient } from "@/components/planning/ppmp-edit-client"
import { PpmpCancelButton } from "@/components/planning/ppmp-cancel-button"

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditPpmpPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const [ppmp, version, { data: { user: authUser } }] = await Promise.all([
    getPpmpById(id),
    getCurrentPpmpVersion(id),
    supabase.auth.getUser(),
  ])
  if (!ppmp) notFound()
  if (ppmp.status !== "draft" && ppmp.status !== "revision_required") redirect(`/dashboard/planning/ppmp/${id}`)
  if (!version) notFound()

  const canCancel = authUser?.id === ppmp.created_by && ppmp.status === "draft"
  const office = ppmp.office as { name: string; code: string; id: string } | undefined
  const fy = ppmp.fiscal_year as { year: number } | undefined
  const projects = await getPpmpProjects(version.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Edit PPMP — {office?.name}</h1>
          <p className="text-sm text-muted-foreground">FY {fy?.year} · Draft</p>
        </div>
        <div className="flex items-center gap-2">
          {canCancel ? <PpmpCancelButton ppmpId={ppmp.id} /> : null}
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/dashboard/planning/ppmp/${id}`} />}>
            <XIcon className="mr-1.5 h-3.5 w-3.5" />
            Close
          </Button>
        </div>
      </div>
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="text-lg font-semibold">Procurement Projects</h2>
          <p className="text-sm text-muted-foreground">Add projects, lots, and line items to your PPMP</p>
        </div>
        <div className="p-5">
          <PpmpEditClient
            ppmpId={ppmp.id}
            ppmpVersionId={version.id}
            officeId={office?.id ?? ""}
            fiscalYearId={ppmp.fiscal_year_id}
            projects={projects}
          />
        </div>
      </div>
    </div>
  )
}
