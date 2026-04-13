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

export const COMPETITIVE_BIDDING_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "created",                    label: "Created",                    description: "Procurement activity initiated" },
  { id: "bid_document_preparation",   label: "Bidding Documents",          description: "BAC Secretariat prepares bidding documents" },
  { id: "pre_procurement_conference", label: "Pre-Procurement Conference", description: "BAC reviews procurement plan" },
  { id: "itb_published",              label: "ITB Published",              description: "Invitation to Bid posted on PhilGEPS" },
  { id: "pre_bid_conference",         label: "Pre-Bid Conference",         description: "Mandatory if ABC > ₱1M for goods" },
  { id: "bid_submission",             label: "Bid Submission",             description: "Deadline for bid submission" },
  { id: "bid_opening",                label: "Bid Opening",               description: "Public opening of submitted bids" },
  { id: "preliminary_examination",    label: "Preliminary Exam",           description: "Check completeness and eligibility" },
  { id: "technical_evaluation",       label: "Technical Evaluation",       description: "BAC evaluates technical requirements" },
  { id: "financial_evaluation",       label: "Financial Evaluation",       description: "BAC evaluates financial proposals" },
  { id: "post_qualification",         label: "Post-Qualification",         description: "Verify LCB docs, specs, NFCC" },
  { id: "bac_resolution",             label: "BAC Resolution",             description: "BAC resolves to recommend award" },
  { id: "award_recommended",          label: "Award Recommended",          description: "BAC recommends LCRB for award" },
  { id: "award_approved",             label: "Award Approved",             description: "HOPE approves the award" },
  { id: "noa_issued",                 label: "NOA Issued",                 description: "Notice of Award sent to winner" },
  { id: "contract_signing",           label: "Contract Signing",           description: "Contract preparation and signing" },
  { id: "ntp_issued",                 label: "NTP Issued",                 description: "Notice to Proceed issued" },
  { id: "completed",                  label: "Completed",                  description: "Procurement completed" },
]

export const DIRECT_CONTRACTING_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "created",                label: "Created",                description: "Procurement activity initiated" },
  { id: "justification_prepared", label: "Justification Prepared", description: "Written justification and price reasonableness" },
  { id: "bac_recommendation",     label: "BAC Recommendation",     description: "BAC reviews and recommends" },
  { id: "hope_approval",          label: "SDS Approval",           description: "Schools Division Superintendent approves" },
  { id: "contract_signing",       label: "Contract Signing",       description: "Contract executed with supplier" },
  { id: "completed",              label: "Completed",              description: "Procurement completed" },
]

export const REPEAT_ORDER_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "created",                label: "Created",                description: "Procurement activity initiated" },
  { id: "reference_verification", label: "Reference Verification", description: "Link and verify original contract" },
  { id: "price_verification",     label: "Price Verification",     description: "Verify price increase ≤ 25%" },
  { id: "bac_confirmation",       label: "BAC Confirmation",       description: "BAC confirms the repeat order" },
  { id: "po_issued",              label: "PO Issued",              description: "Purchase Order issued" },
  { id: "completed",              label: "Completed",              description: "Procurement completed" },
]

export const EMERGENCY_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "created",                label: "Created",                 description: "Emergency procurement initiated" },
  { id: "emergency_purchase",     label: "Emergency Purchase",      description: "Immediate purchase executed" },
  { id: "purchase_documentation", label: "Purchase Documentation",  description: "Post-facto documentation prepared" },
  { id: "bac_post_review",        label: "BAC Post-Review",         description: "BAC reviews within 30 days" },
  { id: "hope_confirmation",      label: "SDS Confirmation",        description: "Schools Division Superintendent confirms" },
  { id: "completed",              label: "Completed",               description: "Procurement completed" },
]

export const NEGOTIATED_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "created",                  label: "Created",                  description: "Procurement activity initiated" },
  { id: "eligibility_verification", label: "Eligibility Verification", description: "Verify 2 prior failed biddings" },
  { id: "bac_negotiation",          label: "BAC Negotiation",          description: "BAC negotiates terms with supplier" },
  { id: "hope_approval",            label: "SDS Approval",             description: "Schools Division Superintendent approves" },
  { id: "contract_signing",         label: "Contract Signing",         description: "Contract executed with supplier" },
  { id: "completed",                label: "Completed",                description: "Procurement completed" },
]

export const AGENCY_TO_AGENCY_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "created",               label: "Created",               description: "Procurement activity initiated" },
  { id: "agency_identification", label: "Agency Identification", description: "Identify partner government agency" },
  { id: "moa_execution",         label: "MOA/MOU Execution",     description: "MOA/MOU signed and executed" },
  { id: "completed",             label: "Completed",             description: "Procurement completed" },
]

export const REQUEST_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "draft",                label: "Draft",              description: "Requester prepares request" },
  { id: "submitted",            label: "Submitted",          description: "Sent to supervisor" },
  { id: "supervisor_approved",  label: "Supervisor Approved", description: "Supervisor endorses" },
  { id: "processing",           label: "Processing",         description: "Supply officer processes" },
  { id: "fulfilled",            label: "Fulfilled",          description: "Request completed" },
]

/**
 * Build step statuses for a request based on its current status.
 */
export function buildRequestSteps(
  status: string,
  request?: {
    supervisor_approved_at?: string | null
    supervisor_remarks?: string | null
    processed_at?: string | null
    rejection_reason?: string | null
  }
): WorkflowStep[] {
  const statusOrder = REQUEST_STEPS.map(s => s.id)

  // Terminal states
  if (status === "cancelled") {
    return REQUEST_STEPS.map(step => ({
      ...step,
      status: "skipped" as StepStatus,
    }))
  }

  if (status === "rejected") {
    const currentIdx = statusOrder.indexOf("submitted")
    return REQUEST_STEPS.map((step, i) => {
      if (i < currentIdx) return { ...step, status: "completed" as StepStatus }
      if (step.id === "submitted" || step.id === "supervisor_approved" || step.id === "processing") {
        // Mark the step where rejection happened
        if (i === currentIdx) {
          return {
            ...step,
            status: "rejected" as StepStatus,
            remarks: request?.rejection_reason || undefined,
          }
        }
      }
      return { ...step, status: "skipped" as StepStatus }
    })
  }

  // partially_fulfilled maps to the "processing" step
  const effectiveStatus = status === "partially_fulfilled" ? "processing" : status
  const currentIdx = statusOrder.indexOf(effectiveStatus)

  return REQUEST_STEPS.map((step, i) => {
    if (i < currentIdx) {
      const built: WorkflowStep = { ...step, status: "completed" as StepStatus }
      if (step.id === "supervisor_approved" && request?.supervisor_approved_at) {
        built.timestamp = request.supervisor_approved_at
        if (request.supervisor_remarks) built.remarks = request.supervisor_remarks
      }
      return built
    }
    if (i === currentIdx) {
      const built: WorkflowStep = { ...step, status: "current" as StepStatus }
      if (step.id === "processing" && request?.processed_at) {
        built.timestamp = request.processed_at
      }
      if (status === "partially_fulfilled") {
        built.description = "Partially fulfilled — awaiting remaining items"
      }
      return built
    }
    return { ...step, status: "pending" as StepStatus }
  })
}

export const PO_STEPS: Omit<WorkflowStep, "status">[] = [
  { id: "draft",                label: "Draft",              description: "PO created from awarded procurement" },
  { id: "approved",             label: "Approved",           description: "HOPE/Division Chief approves" },
  { id: "issued",               label: "Issued",             description: "PO sent to supplier" },
  { id: "partially_delivered",  label: "Partial Delivery",   description: "Some items delivered" },
  { id: "fully_delivered",      label: "Fully Delivered",    description: "All items delivered" },
  { id: "completed",            label: "Completed",          description: "Inspection accepted, PO closed" },
]

/**
 * Build step statuses for a PO based on its current status.
 */
export function buildPoSteps(status: string): WorkflowStep[] {
  const statusOrder = PO_STEPS.map(s => s.id)
  const currentIdx = statusOrder.indexOf(status)

  if (status === "cancelled") {
    return PO_STEPS.map(step => ({
      ...step,
      status: "skipped" as StepStatus,
    }))
  }

  return PO_STEPS.map((step, i) => {
    if (i < currentIdx) return { ...step, status: "completed" as StepStatus }
    if (i === currentIdx) return { ...step, status: "current" as StepStatus }
    return { ...step, status: "pending" as StepStatus }
  })
}

/**
 * Build step statuses for a procurement activity based on its method and current stage.
 */
export function buildProcurementSteps(
  method: string,
  currentStage: string,
  stageHistory: { stage: string; status: string; completed_at: string | null; completed_by: string | null; notes: string | null }[] = []
): WorkflowStep[] {
  const TEMPLATES: Record<string, Omit<WorkflowStep, "status">[]> = {
    svp:                 SVP_STEPS,
    shopping:            SHOPPING_STEPS,
    competitive_bidding: COMPETITIVE_BIDDING_STEPS,
    direct_contracting:  DIRECT_CONTRACTING_STEPS,
    repeat_order:        REPEAT_ORDER_STEPS,
    emergency:           EMERGENCY_STEPS,
    negotiated:          NEGOTIATED_STEPS,
    agency_to_agency:    AGENCY_TO_AGENCY_STEPS,
  }
  const template = TEMPLATES[method] ?? SVP_STEPS
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
