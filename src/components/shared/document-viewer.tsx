"use client"

import { useState } from "react"
import { Eye, Loader2, X, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"

interface DocumentViewerProps {
  /** API endpoint URL for PDF */
  documentUrl: string
  /** Human-readable document title */
  title?: string
  /** Trigger button label */
  triggerLabel?: string
  /** Download file name (no extension) */
  fileName?: string
  size?: "sm" | "default"
}

export function DocumentViewer({
  documentUrl,
  title = "Document",
  triggerLabel = "View",
  fileName = "document",
  size = "sm",
}: DocumentViewerProps) {
  const [open, setOpen] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function openDocument() {
    setLoading(true)
    try {
      const res = await fetch(documentUrl)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }))
        throw new Error(err.error ?? "Failed to load document")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setPdfUrl(url)
      setOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open document")
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setOpen(false)
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl)
      setPdfUrl(null)
    }
  }

  function downloadCurrent() {
    if (!pdfUrl) return
    const a = document.createElement("a")
    a.href = pdfUrl
    a.download = `${fileName}.pdf`
    a.click()
  }

  return (
    <>
      <Button
        variant="outline"
        size={size}
        onClick={openDocument}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Eye className="mr-1.5 h-4 w-4" />
        )}
        {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-3 flex flex-row items-center justify-between border-b shrink-0">
            <DialogTitle>{title}</DialogTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={downloadCurrent}>
                <Download className="mr-1.5 h-4 w-4" />
                Download
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            {pdfUrl && (
              <iframe
                src={pdfUrl}
                className="w-full h-full border-0"
                title={title}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
