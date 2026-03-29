"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { submitPpmp } from "@/lib/actions/ppmp"
import { PpmpItemTable } from "@/components/planning/ppmp-item-table"
import { PpmpItemForm } from "@/components/planning/ppmp-item-form"
import { BudgetLinkageWidget } from "@/components/planning/budget-linkage-widget"
import { Button } from "@/components/ui/button"
import { SendIcon } from "lucide-react"
import type { PpmpItemWithAllocation } from "@/types/database"

interface PpmpEditClientProps {
  ppmpId: string
  ppmpVersionId: string
  officeId: string
  fiscalYearId: string
  items: PpmpItemWithAllocation[]
}

export function PpmpEditClient({ ppmpId, ppmpVersionId, officeId, fiscalYearId, items: initialItems }: PpmpEditClientProps) {
  const router = useRouter()
  const [items] = useState(initialItems)
  const [showItemForm, setShowItemForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const ppmpUsageByAllocation = useMemo(() => {
    const usage: Record<string, number> = {}
    for (const item of items) {
      if (item.budget_allocation_id) {
        usage[item.budget_allocation_id] = (usage[item.budget_allocation_id] ?? 0) + parseFloat(item.estimated_total_cost)
      }
    }
    return usage
  }, [items])

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
      <BudgetLinkageWidget
        officeId={officeId}
        fiscalYearId={fiscalYearId}
        ppmpUsageByAllocation={ppmpUsageByAllocation}
      />

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
