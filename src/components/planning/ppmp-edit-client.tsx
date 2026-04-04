"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PpmpProjectTable } from "@/components/planning/ppmp-item-table"
import { PpmpProjectForm, PpmpLotForm, PpmpLotItemForm } from "@/components/planning/ppmp-item-form"
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
