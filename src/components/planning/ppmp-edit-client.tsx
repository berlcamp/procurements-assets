"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { submitPpmp } from "@/lib/actions/ppmp"
import { PpmpItemTable } from "@/components/planning/ppmp-item-table"
import { PpmpItemForm } from "@/components/planning/ppmp-item-form"
import { Button } from "@/components/ui/button"
import { SendIcon } from "lucide-react"
import type { PpmpItemWithAllocation } from "@/types/database"

interface PpmpEditClientProps {
  ppmpId: string
  ppmpVersionId: string
  officeId: string
  items: PpmpItemWithAllocation[]
}

export function PpmpEditClient({ ppmpId, ppmpVersionId, officeId, items: initialItems }: PpmpEditClientProps) {
  const router = useRouter()
  const [items] = useState(initialItems)
  const [showItemForm, setShowItemForm] = useState(false)
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
      <PpmpItemTable
        items={items}
        editable
        onAddItem={() => setShowItemForm(true)}
        onItemDeleted={() => router.refresh()}
      />

      <div className="flex justify-end gap-3">
        <Button
          onClick={handleSubmit}
          disabled={submitting || items.length === 0}
        >
          <SendIcon className="mr-1.5 h-4 w-4" />
          {submitting ? "Submitting..." : "Submit for Review"}
        </Button>
      </div>

      <PpmpItemForm
        ppmpVersionId={ppmpVersionId}
        ppmpId={ppmpId}
        officeId={officeId}
        open={showItemForm}
        onClose={() => setShowItemForm(false)}
        onSaved={() => router.refresh()}
      />
    </div>
  )
}
