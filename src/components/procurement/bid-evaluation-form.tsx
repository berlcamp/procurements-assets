"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
import { evaluateBids } from "@/lib/actions/procurement-activities"
import type { BidWithDetails } from "@/types/database"

interface BidEvaluationFormProps {
  procurementId: string
  bids: BidWithDetails[]
}

interface EvalRow {
  bid_id: string
  is_responsive: boolean
  is_eligible: boolean
  is_compliant: boolean
  evaluation_score: string
  remarks: string
}

export function BidEvaluationForm({ procurementId, bids }: BidEvaluationFormProps) {
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

  async function handleSubmit() {
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

    toast.success("Bids evaluated and ranked successfully")
    router.refresh()
  }

  return (
    <div className="space-y-4">
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
                  <Checkbox
                    checked={eval_.is_responsive}
                    onCheckedChange={(v) => updateEval(idx, "is_responsive", !!v)}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={eval_.is_eligible}
                    onCheckedChange={(v) => updateEval(idx, "is_eligible", !!v)}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={eval_.is_compliant}
                    onCheckedChange={(v) => updateEval(idx, "is_compliant", !!v)}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={eval_.evaluation_score}
                    onChange={e => updateEval(idx, "evaluation_score", e.target.value)}
                    className="w-20"
                    placeholder="—"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={eval_.remarks}
                    onChange={e => updateEval(idx, "remarks", e.target.value)}
                    className="w-36"
                    placeholder="Optional"
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? "Evaluating..." : "Submit Evaluation"}
        </Button>
      </div>
    </div>
  )
}
