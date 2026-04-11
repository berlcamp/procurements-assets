"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, X, ShieldCheck, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AmountDisplay } from "@/components/shared/amount-display"
import { toast } from "sonner"
import {
  evaluateBids,
  confirmBidEvaluations,
} from "@/lib/actions/procurement-activities"
import type { BidWithDetails } from "@/types/database"

export type EvaluationMode = "draft" | "confirm"

interface BidEvaluationFormProps {
  procurementId: string
  bids: BidWithDetails[]
  /**
   * "draft"   — BAC Secretariat editing the evaluation draft
   * "confirm" — BAC voting member viewing the Secretariat's draft to confirm
   */
  mode: EvaluationMode
  /** Whether the current user has already confirmed this procurement's evaluation (confirm mode only). */
  hasConfirmed?: boolean
  /** Whether the user had a prior confirmation that was invalidated by a Secretariat edit. */
  hasStaleConfirmation?: boolean
  /** Quorum progress badge. */
  confirmedMembers?: number
  requiredMembers?: number
}

interface EvalRow {
  bid_id: string
  is_responsive: boolean
  is_eligible: boolean
  is_compliant: boolean
  evaluation_score: string
  remarks: string
}

function BoolCell({ value }: { value: boolean }) {
  return value
    ? <Check className="h-4 w-4 text-green-600 mx-auto" />
    : <X className="h-4 w-4 text-red-500 mx-auto" />
}

export function BidEvaluationForm({
  procurementId,
  bids,
  mode,
  hasConfirmed = false,
  hasStaleConfirmation = false,
  confirmedMembers = 0,
  requiredMembers = 3,
}: BidEvaluationFormProps) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const [evals, setEvals] = useState<EvalRow[]>(
    bids.map(b => ({
      bid_id: b.id,
      is_responsive: b.is_responsive,
      is_eligible: b.is_eligible,
      is_compliant: b.is_compliant,
      evaluation_score: b.evaluation_score ?? "",
      remarks: b.remarks ?? "",
    }))
  )

  function updateEval(index: number, field: string, value: boolean | string) {
    setEvals(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  async function handleDraftSubmit() {
    setLoading(true)
    const result = await evaluateBids({
      procurement_id: procurementId,
      evaluations: evals.map(e => ({
        bid_id: e.bid_id,
        is_responsive: e.is_responsive,
        is_eligible: e.is_eligible,
        is_compliant: e.is_compliant,
        evaluation_score: e.evaluation_score || null,
        remarks: e.remarks || null,
      })),
    })
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success(
      confirmedMembers > 0
        ? "Draft saved. Existing BAC confirmations were invalidated — members have been asked to re-confirm."
        : "Evaluation draft saved successfully"
    )
    router.refresh()
  }

  async function handleConfirm() {
    setLoading(true)
    const result = await confirmBidEvaluations(procurementId)
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success("You confirmed the BAC Secretariat's evaluation draft")
    router.refresh()
  }

  const isDraftMode = mode === "draft"
  const locked = !isDraftMode
  const quorumMet = confirmedMembers >= requiredMembers

  return (
    <div className="space-y-4">
      {/* Mode banner */}
      {isDraftMode ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>BAC Secretariat draft.</strong> You are the only role that can edit
          these fields. When you save, any existing BAC member confirmations will be
          invalidated and members will be asked to re-confirm.
        </div>
      ) : (
        <div className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900 flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <strong>BAC confirmation.</strong> Review the draft prepared by the BAC
            Secretariat and click <strong>Confirm</strong> to record your agreement.
            You cannot edit the fields — raise any disagreement at the BAC meeting and
            the Secretariat will revise the draft for re-confirmation.
          </div>
        </div>
      )}

      {/* Stale confirmation banner */}
      {!isDraftMode && hasStaleConfirmation && !hasConfirmed && (
        <div className="rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-xs text-orange-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <strong>Evaluation was revised.</strong> The BAC Secretariat updated the
            draft after your previous confirmation. Please review the current values and
            confirm again.
          </div>
        </div>
      )}

      {/* Quorum progress */}
      <div className="text-xs text-muted-foreground">
        BAC confirmations:{" "}
        <span className={quorumMet ? "text-green-700 font-medium" : "font-medium"}>
          {confirmedMembers} of {requiredMembers}
        </span>
        {quorumMet && " — quorum met"}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">Bid Amount</TableHead>
            <TableHead className="text-center">Responsive</TableHead>
            <TableHead className="text-center">Eligible</TableHead>
            <TableHead className="text-center">Compliant</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Remarks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {evals.map((eval_, idx) => {
            const bid = bids[idx]
            return (
              <TableRow key={eval_.bid_id}>
                <TableCell className="text-sm font-medium">
                  {bid.supplier?.name ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <AmountDisplay amount={bid.bid_amount} />
                </TableCell>
                <TableCell className="text-center">
                  {locked ? (
                    <BoolCell value={eval_.is_responsive} />
                  ) : (
                    <Checkbox
                      checked={eval_.is_responsive}
                      onCheckedChange={(v) => updateEval(idx, "is_responsive", !!v)}
                    />
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {locked ? (
                    <BoolCell value={eval_.is_eligible} />
                  ) : (
                    <Checkbox
                      checked={eval_.is_eligible}
                      onCheckedChange={(v) => updateEval(idx, "is_eligible", !!v)}
                    />
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {locked ? (
                    <BoolCell value={eval_.is_compliant} />
                  ) : (
                    <Checkbox
                      checked={eval_.is_compliant}
                      onCheckedChange={(v) => updateEval(idx, "is_compliant", !!v)}
                    />
                  )}
                </TableCell>
                <TableCell>
                  {locked ? (
                    <span className="font-mono text-sm">{eval_.evaluation_score || "—"}</span>
                  ) : (
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={eval_.evaluation_score}
                      onChange={e => updateEval(idx, "evaluation_score", e.target.value)}
                      className="w-20"
                      placeholder="—"
                    />
                  )}
                </TableCell>
                <TableCell>
                  {locked ? (
                    <span className="text-xs text-muted-foreground">{eval_.remarks || "—"}</span>
                  ) : (
                    <Input
                      value={eval_.remarks}
                      onChange={e => updateEval(idx, "remarks", e.target.value)}
                      className="w-36"
                      placeholder="Optional"
                    />
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <div className="flex justify-end gap-2">
        {isDraftMode && (
          <Button onClick={handleDraftSubmit} disabled={loading}>
            {loading ? "Saving..." : "Save Evaluation Draft"}
          </Button>
        )}

        {!isDraftMode && hasConfirmed && !hasStaleConfirmation && (
          <div className="flex items-center gap-2 text-sm text-green-700">
            <ShieldCheck className="h-4 w-4" />
            You have confirmed this evaluation.
          </div>
        )}

        {!isDraftMode && (!hasConfirmed || hasStaleConfirmation) && (
          <Button onClick={handleConfirm} disabled={loading || bids.length === 0}>
            {loading
              ? "Confirming..."
              : hasStaleConfirmation
                ? "Re-confirm Evaluation"
                : "Confirm Evaluation"}
          </Button>
        )}
      </div>
    </div>
  )
}
