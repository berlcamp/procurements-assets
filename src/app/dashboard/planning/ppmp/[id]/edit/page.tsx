import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { getPpmpById, getCurrentPpmpVersion, getPpmpItems } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import { PpmpEditClient } from "@/components/planning/ppmp-edit-client"
import type { PpmpWithDetails, PpmpItemWithAllocation } from "@/types/database"

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditPpmpPage({ params }: Props) {
  const { id } = await params
  const [ppmp, version] = await Promise.all([
    getPpmpById(id),
    getCurrentPpmpVersion(id),
  ])
  if (!ppmp) notFound()
  if (ppmp.status !== "draft") redirect(`/dashboard/planning/ppmp/${id}`)
  if (!version) notFound()

  const office = ppmp.office as { name: string; code: string; id: string } | undefined
  const fy = ppmp.fiscal_year as { year: number } | undefined
  const items = await getPpmpItems(version.id)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Edit PPMP — {office?.name}</h1>
          <p className="text-sm text-muted-foreground">FY {fy?.year} · Draft</p>
        </div>
        <Link href={`/dashboard/planning/ppmp/${id}`}>
          <Button variant="outline" size="sm">Cancel</Button>
        </Link>
      </div>
      <PpmpEditClient
        ppmpId={ppmp.id}
        ppmpVersionId={version.id}
        officeId={office?.id ?? ""}
        items={items as PpmpItemWithAllocation[]}
      />
    </div>
  )
}
