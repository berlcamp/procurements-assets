"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FileText, Upload } from "lucide-react"
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
import { ProcurementDocumentUpload } from "./procurement-document-upload"
import { uploadBacResolution } from "@/lib/actions/procurement-activities"

interface BacResolutionDialogProps {
  procurementId: string
  divisionId: string
  currentNumber: string | null
  currentDate: string | null
  currentFileUrl: string | null
}

export function BacResolutionDialog({
  procurementId,
  divisionId,
  currentNumber,
  currentDate,
  currentFileUrl,
}: BacResolutionDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resolutionNumber, setResolutionNumber] = useState(currentNumber ?? "")
  const [resolutionDate, setResolutionDate] = useState(currentDate ?? "")

  async function handleSaveMetadata() {
    if (!resolutionNumber.trim() || !resolutionDate) {
      toast.error("Resolution number and date are required")
      return
    }
    if (!currentFileUrl) {
      toast.error("Upload the resolution file before saving metadata")
      return
    }

    setLoading(true)
    const result = await uploadBacResolution({
      procurement_id:    procurementId,
      resolution_number: resolutionNumber.trim(),
      resolution_date:   resolutionDate,
      file_url:          currentFileUrl,
    })
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    toast.success("BAC Resolution metadata saved")
    setOpen(false)
    router.refresh()
  }

  const isUpdate = !!currentFileUrl

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button size="sm" variant={isUpdate ? "outline" : "default"}>
          {isUpdate ? <FileText className="mr-1 h-4 w-4" /> : <Upload className="mr-1 h-4 w-4" />}
          {isUpdate ? "Update BAC Resolution" : "Upload BAC Resolution"}
        </Button>
      } />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isUpdate ? "Update BAC Resolution" : "Upload BAC Resolution"}
          </DialogTitle>
          <DialogDescription>
            Record the signed BAC Resolution. The file is uploaded directly to
            your division&apos;s document storage. Required before advancing to
            Award Recommended.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="resolution-number">Resolution Number</Label>
            <Input
              id="resolution-number"
              placeholder="e.g. BAC Res. No. 2026-014"
              value={resolutionNumber}
              onChange={e => setResolutionNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="resolution-date">Resolution Date</Label>
            <Input
              id="resolution-date"
              type="date"
              value={resolutionDate}
              onChange={e => setResolutionDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Resolution File</Label>
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <ProcurementDocumentUpload
                procurementId={procurementId}
                divisionId={divisionId}
                docType="bac_resolution"
                currentPath={currentFileUrl}
              />
              <p className="text-xs text-muted-foreground mt-2">
                PDF, PNG, JPG, or Word document. Max 50 MB.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={handleSaveMetadata} disabled={loading || !currentFileUrl}>
            {loading ? "Saving..." : "Save Number & Date"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
