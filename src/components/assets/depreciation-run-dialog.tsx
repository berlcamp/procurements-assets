"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { runMonthlyDepreciation } from "@/lib/actions/assets"
import {
  runDepreciationSchema,
  type RunDepreciationInput,
} from "@/lib/schemas/asset"

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
]

interface DepreciationRunDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function DepreciationRunDialog({
  open,
  onOpenChange,
  onComplete,
}: DepreciationRunDialogProps) {
  const now = new Date()

  const {
    setValue,
    watch,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<RunDepreciationInput>({
    resolver: zodResolver(runDepreciationSchema),
    defaultValues: {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    },
  })

  async function onSubmit(data: RunDepreciationInput) {
    const result = await runMonthlyDepreciation(data)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Depreciation completed for ${result.count} asset(s)`)
      onComplete()
    }
  }

  // Generate year options (current year -1 to current year)
  const years = [now.getFullYear() - 1, now.getFullYear()]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Run Monthly Depreciation</DialogTitle>
          <DialogDescription>
            Process straight-line depreciation for all active PPE assets in your division.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Year</Label>
              <Select
                value={watch("year").toString()}
                onValueChange={(v) => setValue("year", parseInt(v ?? "0"))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={y.toString()}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Month</Label>
              <Select
                value={watch("month").toString()}
                onValueChange={(v) => setValue("month", parseInt(v ?? "1"))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={m.value.toString()}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Processing..." : "Run Depreciation"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
