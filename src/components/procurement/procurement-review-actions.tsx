"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import {
  advanceProcurementStage,
  approveAward,
  failProcurement,
} from "@/lib/actions/procurement-activities"

type ActionType = "advance" | "approve_award" | "fail" | null

interface ProcurementReviewActionsProps {
  procurementId: string
  procurementMethod: string
  currentStage: string
  status: string
  bidsCount: number
  responsiveBidsCount: number
  awardedBidId: string | null
  canAdvance: boolean
  canRecordBid: boolean
  canEvaluate: boolean
  canConfirm: boolean
  canRecommendAward: boolean
  canApproveAward: boolean
  canFail: boolean
}

// Next stage mapping per method (must mirror advance_procurement_stage)
const SVP_STAGE_ORDER = [
  "created", "rfq_preparation", "rfq_sent", "quotations_received",
  "evaluation", "abstract_prepared", "post_qualification",
  "award_recommended", "award_approved", "completed",
]
const SHOPPING_STAGE_ORDER = [
  "created", "canvass_preparation", "canvass_sent", "canvass_received",
  "comparison", "post_qualification",
  "award_recommended", "award_approved", "completed",
]
const COMPETITIVE_BIDDING_STAGE_ORDER = [
  "created", "bid_document_preparation", "pre_procurement_conference",
  "itb_published", "pre_bid_conference", "bid_submission", "bid_opening",
  "preliminary_examination", "technical_evaluation", "financial_evaluation",
  "post_qualification", "bac_resolution",
  "award_recommended", "award_approved",
  "noa_issued", "contract_signing", "ntp_issued", "completed",
]

function getNextStage(method: string, current: string): string | null {
  const stages = method === "svp" ? SVP_STAGE_ORDER
    : method === "competitive_bidding" ? COMPETITIVE_BIDDING_STAGE_ORDER
    : SHOPPING_STAGE_ORDER
  const idx = stages.indexOf(current)
  if (idx === -1 || idx >= stages.length - 1) return null
  return stages[idx + 1]
}

function getNextStageLabel(stage: string): string {
  return stage
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

export function ProcurementReviewActions({
  procurementId,
  procurementMethod,
  currentStage,
  status,
  bidsCount,
  responsiveBidsCount,
  awardedBidId,
  canAdvance,
  canRecordBid,
  canEvaluate,
  canConfirm,
  canRecommendAward,
  canApproveAward,
  canFail,
}: ProcurementReviewActionsProps) {
  const [action, setAction] = useState<ActionType>(null)
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  if (status !== "active") return null

  const nextStage = getNextStage(procurementMethod, currentStage)
  // Don't show Advance at award_recommended — that transition is handled by
  // the HOPE-only Approve Award action. Every other stage (including
  // bac_resolution) shows the button; the DB-level stage gates raise clear
  // exceptions if prerequisites are missing (e.g. BAC Resolution file
  // missing, no awarded supplier).
  const showAdvance = canAdvance && nextStage && currentStage !== "award_recommended"
  const showApproveAward = canApproveAward && currentStage === "award_recommended"
  const showFail = canFail
  // Secretariat sees a "Draft Evaluation" button at evaluation-capable stages.
  // BAC voting members see a "Confirm Evaluation" button at the same stages.
  const EVAL_STAGES = [
    "quotations_received", "canvass_received",
    "evaluation", "comparison", "abstract_prepared",
    "preliminary_examination", "technical_evaluation", "financial_evaluation",
    "post_qualification", "bac_resolution",
  ]
  const showEvaluate = canEvaluate && EVAL_STAGES.includes(currentStage)
  // Only show Confirm to users who cannot draft — Secretariat already has Draft
  const showConfirm  = !canEvaluate && canConfirm && EVAL_STAGES.includes(currentStage)

  async function handleConfirm() {
    setLoading(true)
    let result: { error: string | null }

    if (action === "advance" && nextStage) {
      result = await advanceProcurementStage(procurementId, {
        next_stage: nextStage,
        notes: notes || null,
      })
    } else if (action === "approve_award") {
      result = await approveAward(procurementId, { notes: notes || null })
    } else if (action === "fail") {
      if (notes.length < 5) {
        toast.error("Reason must be at least 5 characters")
        setLoading(false)
        return
      }
      result = await failProcurement(procurementId, { reason: notes })
    } else {
      setLoading(false)
      return
    }

    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    const actionLabels: Record<string, string> = {
      advance: `Advanced to ${getNextStageLabel(nextStage ?? "")}`,
      approve_award: "Award approved",
      fail: "Procurement marked as failed",
    }
    toast.success(actionLabels[action!] ?? "Action completed")
    setAction(null)
    setNotes("")
    router.refresh()
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {showEvaluate && (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/dashboard/procurement/activities/${procurementId}/evaluation`} />}
          >
            Draft Evaluation
          </Button>
        )}

        {showConfirm && (
          <Button
            size="sm"
            variant="default"
            nativeButton={false}
            render={<Link href={`/dashboard/procurement/activities/${procurementId}/evaluation`} />}
          >
            Confirm Evaluation
          </Button>
        )}

        {showAdvance && (
          <Button
            size="sm"
            onClick={() => { setAction("advance"); setNotes("") }}
          >
            Advance to {getNextStageLabel(nextStage!)}
          </Button>
        )}

        {showApproveAward && (
          <Button
            size="sm"
            variant="default"
            onClick={() => { setAction("approve_award"); setNotes("") }}
          >
            Approve Award
          </Button>
        )}

        {showFail && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => { setAction("fail"); setNotes("") }}
          >
            Fail Procurement
          </Button>
        )}
      </div>

      <Dialog open={!!action} onOpenChange={(v) => { if (!v) setAction(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "advance" && `Advance to ${getNextStageLabel(nextStage ?? "")}`}
              {action === "approve_award" && "Approve Award (Schools Division Superintendent)"}
              {action === "fail" && "Fail Procurement"}
            </DialogTitle>
            <DialogDescription>
              {action === "advance" && "This will move the procurement to the next workflow stage."}
              {action === "approve_award" && "As Schools Division Superintendent (Head of Procuring Entity), approve the BAC's recommended award to the winning bidder. The procurement will advance to NOA Issued."}
              {action === "fail" && "Mark this procurement as failed. The Purchase Request will be returned to approved status."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label>{action === "fail" ? "Reason (required)" : "Notes (optional)"}</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={action === "fail" ? "Enter reason for failure..." : "Add notes..."}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>Cancel</Button>
            <Button
              variant={action === "fail" ? "destructive" : "default"}
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
