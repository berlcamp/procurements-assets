"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ShieldCheck, Edit } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  recordPerformanceSecurity,
  type PerformanceSecurityForm,
} from "@/lib/actions/procurement-activities"

interface PerformanceSecurityDialogProps {
  procurementId: string
  /** Current amount on the procurement (auto-calculated when award is recommended). */
  suggestedAmount: string | null
  /** Whether security has already been recorded — if so, the dialog opens in update mode. */
  isRecorded: boolean
  currentForm: string | null
  currentReference: string | null
  currentAmount: string | null
}

const FORM_LABELS: Record<PerformanceSecurityForm, string> = {
  cash:            "Cash / Cashier's Check (5%)",
  bank_draft:      "Bank Draft (5%)",
  managers_check:  "Manager's Check (5%)",
  irrevocable_loc: "Irrevocable Letter of Credit (5%)",
  surety_bond:     "Surety Bond (30%)",
  bank_guarantee:  "Bank Guarantee (5%)",
}

export function PerformanceSecurityDialog({
  procurementId,
  suggestedAmount,
  isRecorded,
  currentForm,
  currentReference,
  currentAmount,
}: PerformanceSecurityDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [amount, setAmount] = useState(currentAmount ?? suggestedAmount ?? "")
  const [form, setForm] = useState<PerformanceSecurityForm | "">(
    (currentForm as PerformanceSecurityForm | null) ?? ""
  )
  const [reference, setReference] = useState(currentReference ?? "")

  async function handleSubmit() {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Amount must be greater than zero")
      return
    }
    if (!form) {
      toast.error("Select the form of performance security")
      return
    }
    if (!reference.trim()) {
      toast.error("Reference number is required")
      return
    }

    setLoading(true)
    const result = await recordPerformanceSecurity({
      procurement_id: procurementId,
      amount,
      form: form as PerformanceSecurityForm,
      reference: reference.trim(),
    })
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success(
      isRecorded
        ? "Performance security updated"
        : "Performance security recorded — you can now advance to Contract Signing"
    )
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button size="sm" variant={isRecorded ? "outline" : "default"}>
          {isRecorded
            ? <Edit className="mr-1 h-4 w-4" />
            : <ShieldCheck className="mr-1 h-4 w-4" />}
          {isRecorded ? "Update Security" : "Record Performance Security"}
        </Button>
      } />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isRecorded ? "Update Performance Security" : "Record Performance Security"}
          </DialogTitle>
          <DialogDescription>
            Record the performance security posted by the winning bidder. RA 12009 IRR §39
            requires this before the contract is signed. The default amount is 5% of the
            contract amount (30% if posted as a surety bond).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="ps-amount">Amount Posted (₱)</Label>
            <Input
              id="ps-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
            />
            {suggestedAmount && (
              <p className="text-xs text-muted-foreground">
                Suggested (5% of contract amount): ₱{parseFloat(suggestedAmount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="ps-form">Form</Label>
            <Select value={form} onValueChange={(v) => setForm(v as PerformanceSecurityForm)}>
              <SelectTrigger id="ps-form">
                <SelectValue placeholder="Select form of security" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FORM_LABELS) as PerformanceSecurityForm[]).map(key => (
                  <SelectItem key={key} value={key}>
                    {FORM_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ps-reference">Reference Number</Label>
            <Input
              id="ps-reference"
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="e.g. Check No. 1234567 / Bond No. SB-2026-04"
            />
            <p className="text-xs text-muted-foreground">
              The check number, bond number, or letter of credit reference on the security instrument.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Saving..." : isRecorded ? "Update" : "Record Security"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
