"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { submitPpmp } from "@/lib/actions/ppmp"
import { PpmpProjectTable } from "@/components/planning/ppmp-item-table"
import { PpmpProjectForm, PpmpLotForm, PpmpLotItemForm } from "@/components/planning/ppmp-item-form"
import { Button } from "@/components/ui/button"
import { SendIcon } from "lucide-react"
import type { PpmpProjectWithLots } from "@/types/database"

interface PpmpEditClientProps {
  ppmpId: string
  ppmpVersionId: string
  officeId: string
  fiscalYearId: string
  projects: PpmpProjectWithLots[]
}

export function PpmpEditClient({
  ppmpId, ppmpVersionId, officeId, fiscalYearId, projects: initialProjects,
}: PpmpEditClientProps) {
  const router = useRouter()
  const [projects, setProjects] = useState(initialProjects)
  useEffect(() => { setProjects(initialProjects) }, [initialProjects])
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [lotFormProjectId, setLotFormProjectId] = useState<string | null>(null)
  const [itemFormLotId, setItemFormLotId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    setSubmitting(true)
    const result = await submitPpmp(ppmpId)
    setSubmitting(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("PPMP submitted for review.")
    router.push(`/dashboard/planning/ppmp/${ppmpId}`)
  }

  return (
    <div className="space-y-6">
      <PpmpProjectTable
        projects={projects}
        editable
        onAddProject={() => setShowProjectForm(true)}
        onAddLot={(projectId) => setLotFormProjectId(projectId)}
        onAddItem={(lotId) => setItemFormLotId(lotId)}
        onChanged={() => router.refresh()}
      />

      <div className="flex justify-end gap-3">
        <Button
          onClick={handleSubmit}
          disabled={submitting || projects.length === 0}
        >
          <SendIcon className="mr-1.5 h-4 w-4" />
          {submitting ? "Submitting..." : "Submit for Review"}
        </Button>
      </div>

      {/* Project form dialog */}
      <PpmpProjectForm
        ppmpVersionId={ppmpVersionId}
        ppmpId={ppmpId}
        officeId={officeId}
        open={showProjectForm}
        onClose={() => setShowProjectForm(false)}
        onSaved={() => router.refresh()}
      />

      {/* Lot form dialog */}
      {lotFormProjectId && (
        <PpmpLotForm
          projectId={lotFormProjectId}
          open={!!lotFormProjectId}
          onClose={() => setLotFormProjectId(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {/* Lot item form dialog */}
      {itemFormLotId && (
        <PpmpLotItemForm
          lotId={itemFormLotId}
          open={!!itemFormLotId}
          onClose={() => setItemFormLotId(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  )
}
