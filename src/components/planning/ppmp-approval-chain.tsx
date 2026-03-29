import { ApprovalStepper, PPMP_STEPS, type WorkflowStep, type StepStatus } from "@/components/shared/approval-stepper"
import type { Ppmp } from "@/types/database"

interface PpmpApprovalChainProps {
  ppmp: Ppmp
}

function getStepStatus(ppmp: Ppmp, stepId: string): StepStatus {
  const order = ["draft", "submitted", "chief_reviewed", "budget_certified", "approved", "locked"]
  const currentIdx = order.indexOf(
    ppmp.status === "revision_required" ? "submitted" : ppmp.status
  )
  const stepIdx = order.indexOf(stepId)

  if (stepIdx < currentIdx) return "completed"
  if (stepIdx === currentIdx) {
    if (ppmp.status === "revision_required" && stepId === "submitted") return "rejected"
    return "current"
  }
  return "pending"
}

function getStepActor(ppmp: Ppmp, stepId: string): string | undefined {
  switch (stepId) {
    case "submitted":
      return ppmp.submitted_at
        ? `Submitted ${new Date(ppmp.submitted_at).toLocaleDateString("en-PH")}`
        : undefined
    case "chief_reviewed":
      return ppmp.chief_reviewed_at
        ? `Reviewed ${new Date(ppmp.chief_reviewed_at).toLocaleDateString("en-PH")}`
        : undefined
    case "budget_certified":
      return ppmp.budget_certified_at
        ? `Certified ${new Date(ppmp.budget_certified_at).toLocaleDateString("en-PH")}`
        : undefined
    case "approved":
      return ppmp.approved_at
        ? `Approved ${new Date(ppmp.approved_at).toLocaleDateString("en-PH")}`
        : undefined
    default:
      return undefined
  }
}

function getStepRemarks(ppmp: Ppmp, stepId: string): string | undefined {
  switch (stepId) {
    case "chief_reviewed": return ppmp.chief_review_notes ?? undefined
    case "budget_certified": return ppmp.budget_certification_notes ?? undefined
    case "approved": return ppmp.approval_notes ?? undefined
    default: return undefined
  }
}

export function PpmpApprovalChain({ ppmp }: PpmpApprovalChainProps) {
  const steps: WorkflowStep[] = PPMP_STEPS.map((s) => ({
    ...s,
    status: getStepStatus(ppmp, s.id),
    actor: getStepActor(ppmp, s.id),
    remarks: getStepRemarks(ppmp, s.id),
  }))

  return <ApprovalStepper steps={steps} orientation="vertical" />
}
