import { Check, X, Clock, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

export type StepStatus = "completed" | "current" | "pending" | "rejected" | "skipped"

export interface WorkflowStep {
  id: string
  label: string
  description?: string
  status: StepStatus
  actor?: string
  timestamp?: string
  remarks?: string
}

interface ApprovalStepperProps {
  steps: WorkflowStep[]
  orientation?: "horizontal" | "vertical"
  className?: string
}

// ── Pre-built step configs ──────────────────────────────────────────────────

export const PPMP_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "draft",            label: "Draft",            description: "End User prepares PPMP" },
  { id: "submitted",        label: "Submitted",        description: "Sent to Section Chief" },
  { id: "chief_reviewed",   label: "Chief Reviewed",   description: "Section Chief endorses" },
  { id: "budget_certified", label: "Budget Certified", description: "Budget Officer certifies" },
  { id: "approved",         label: "Approved",         description: "HOPE approves" },
  { id: "locked",           label: "Locked",           description: "Frozen after approval" },
]

export const APP_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "populating",      label: "Populating",      description: "Auto-aggregating from PPMPs" },
  { id: "indicative",      label: "Indicative",      description: "Initial draft APP" },
  { id: "under_review",    label: "Under Review",    description: "HOPE reviews rows" },
  { id: "bac_finalization",label: "BAC Finalization", description: "BAC assigns lots" },
  { id: "final",           label: "Final",           description: "Finalization complete" },
  { id: "approved",        label: "Approved",        description: "HOPE approves APP" },
  { id: "posted",          label: "Posted",          description: "Published to PhilGEPS" },
]

export const PR_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "draft",            label: "Draft",            description: "End User creates PR" },
  { id: "submitted",        label: "Submitted",        description: "Sent for certification" },
  { id: "budget_certified", label: "Budget Certified", description: "Budget Officer certifies" },
  { id: "approved",         label: "Approved",         description: "Approving authority signs" },
  { id: "in_procurement",   label: "In Procurement",   description: "BAC processing" },
  { id: "completed",        label: "Completed",        description: "Procurement done" },
]

export const PROCUREMENT_PIPELINE_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "ppmp", label: "PPMP", description: "Procurement planning" },
  { id: "app",  label: "APP",  description: "Annual plan" },
  { id: "pr",   label: "PR",   description: "Purchase request" },
  { id: "proc", label: "Procurement", description: "BAC & awarding" },
]

export const SVP_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "created",             label: "Created",             description: "Procurement activity initiated" },
  { id: "rfq_preparation",    label: "RFQ Preparation",     description: "Prepare Request for Quotation" },
  { id: "rfq_sent",           label: "RFQ Sent",            description: "RFQ sent to ≥3 suppliers" },
  { id: "quotations_received",label: "Quotations Received", description: "Supplier quotations recorded" },
  { id: "evaluation",         label: "Evaluation",          description: "BAC evaluates quotations" },
  { id: "abstract_prepared",  label: "Abstract Prepared",   description: "Abstract of Canvass completed" },
  { id: "post_qualification", label: "Post-Qualification",  description: "Verify LCB docs, specs, capacity" },
  { id: "award_recommended",  label: "Award Recommended",   description: "BAC recommends lowest bidder" },
  { id: "award_approved",     label: "Award Approved",      description: "HOPE approves award" },
  { id: "completed",          label: "Completed",           description: "Ready for Purchase Order" },
]

export const SHOPPING_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "created",              label: "Created",              description: "Procurement activity initiated" },
  { id: "canvass_preparation", label: "Canvass Preparation",  description: "Prepare canvass sheets" },
  { id: "canvass_sent",       label: "Canvass Sent",         description: "Sent to ≥3 suppliers" },
  { id: "canvass_received",   label: "Canvass Received",     description: "Supplier responses recorded" },
  { id: "comparison",         label: "Price Comparison",     description: "Compare supplier prices" },
  { id: "post_qualification", label: "Post-Qualification",   description: "Verify LCB docs, specs, capacity" },
  { id: "award_recommended",  label: "Award Recommended",    description: "Recommend lowest price" },
  { id: "award_approved",     label: "Award Approved",       description: "HOPE approves award" },
  { id: "completed",          label: "Completed",            description: "Ready for Purchase Order" },
]

/**
 * Build step statuses for a procurement activity based on its method and current stage.
 */
export function buildProcurementSteps(
  method: string,
  currentStage: string,
  stageHistory: { stage: string; status: string; completed_at: string | null; completed_by: string | null; notes: string | null }[] = []
): WorkflowStep[] {
  const template = method === "svp" ? SVP_STEPS : SHOPPING_STEPS
  const historyMap = new Map(stageHistory.map(s => [s.stage, s]))

  let foundCurrent = false
  return template.map(step => {
    const history = historyMap.get(step.id)

    if (history?.status === "completed") {
      return {
        ...step,
        status: "completed" as StepStatus,
        timestamp: history.completed_at || undefined,
        remarks: history.notes || undefined,
      }
    }

    if (step.id === currentStage) {
      foundCurrent = true
      return { ...step, status: "current" as StepStatus }
    }

    if (!foundCurrent) {
      // Stages before current that aren't in history — completed implicitly
      return { ...step, status: "completed" as StepStatus }
    }

    return { ...step, status: "pending" as StepStatus }
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function StepIcon({ status, index }: { status: StepStatus; index: number }) {
  const base = "flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold shrink-0"

  if (status === "completed")
    return (
      <div className={cn(base, "border-green-500 bg-green-50 text-green-600")}>
        <Check className="h-4 w-4" />
      </div>
    )
  if (status === "rejected")
    return (
      <div className={cn(base, "border-red-500 bg-red-50 text-red-600")}>
        <X className="h-4 w-4" />
      </div>
    )
  if (status === "current")
    return (
      <div className={cn(base, "border-blue-500 bg-blue-50 text-blue-600")}>
        <Clock className="h-4 w-4" />
      </div>
    )
  if (status === "skipped")
    return (
      <div className={cn(base, "border-gray-300 bg-gray-50 text-gray-400")}>
        <Minus className="h-4 w-4" />
      </div>
    )
  return (
    <div className={cn(base, "border-gray-300 bg-white text-gray-400")}>
      {index + 1}
    </div>
  )
}

function ConnectorLine({ completed, orientation }: { completed: boolean; orientation: "horizontal" | "vertical" }) {
  if (orientation === "horizontal")
    return (
      <div className={cn("h-0.5 flex-1 mt-4", completed ? "bg-green-300" : "bg-gray-200")} />
    )
  return (
    <div className={cn("w-0.5 flex-1 ml-4 min-h-4", completed ? "bg-green-300" : "bg-gray-200")} />
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function ApprovalStepper({ steps, orientation = "vertical", className }: ApprovalStepperProps) {
  if (orientation === "horizontal") {
    return (
      <div className={cn("flex items-start gap-0", className)}>
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-start">
            <div className="flex flex-col items-center gap-1.5">
              <StepIcon status={step.status} index={i} />
              <div className="text-center">
                <p className={cn(
                  "text-xs font-medium",
                  step.status === "completed" && "text-green-700",
                  step.status === "current" && "text-blue-700",
                  step.status === "rejected" && "text-red-700",
                  step.status === "pending" && "text-gray-500",
                  step.status === "skipped" && "text-gray-400",
                )}>
                  {step.label}
                </p>
                {step.description && (
                  <p className="text-xs text-muted-foreground max-w-[80px]">{step.description}</p>
                )}
              </div>
            </div>
            {i < steps.length - 1 && (
              <ConnectorLine completed={step.status === "completed"} orientation="horizontal" />
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {steps.map((step, i) => (
        <div key={step.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <StepIcon status={step.status} index={i} />
            {i < steps.length - 1 && (
              <ConnectorLine completed={step.status === "completed"} orientation="vertical" />
            )}
          </div>
          <div className={cn("pb-5", i === steps.length - 1 && "pb-0")}>
            <p className={cn(
              "text-sm font-medium leading-8",
              step.status === "completed" && "text-green-700",
              step.status === "current" && "text-blue-700",
              step.status === "rejected" && "text-red-700",
              step.status === "pending" && "text-gray-500",
              step.status === "skipped" && "text-gray-400",
            )}>
              {step.label}
            </p>
            {step.description && (
              <p className="text-xs text-muted-foreground">{step.description}</p>
            )}
            {step.actor && (
              <p className="text-xs text-muted-foreground">
                {step.actor}
                {step.timestamp && <span className="ml-1">— {step.timestamp}</span>}
              </p>
            )}
            {step.remarks && (
              <p className="mt-1 text-xs text-muted-foreground italic">"{step.remarks}"</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
