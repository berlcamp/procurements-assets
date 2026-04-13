"use client"

import { useState } from "react"
import { Download, Loader2, Printer, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"

interface PrintDownloadButtonProps {
  /** The API endpoint URL for PDF download, e.g. /api/documents/pr/[id] */
  downloadUrl: string
  /** Document label shown in button text, e.g. "PR", "PO" */
  label?: string
  /** File name for download (without extension) */
  fileName?: string
  /** Size variant */
  size?: "sm" | "default" | "lg"
  /** Use icon-only mode */
  iconOnly?: boolean
}

export function PrintDownloadButton({
  downloadUrl,
  label = "PDF",
  fileName,
  size = "sm",
  iconOnly = false,
}: PrintDownloadButtonProps) {
  const [loading, setLoading] = useState(false)

  async function fetchPdf(): Promise<Blob | null> {
    const res = await fetch(downloadUrl)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" }))
      throw new Error(err.error ?? "Failed to generate PDF")
    }
    return res.blob()
  }

  async function downloadPdf() {
    setLoading(true)
    try {
      const blob = await fetchPdf()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName ? `${fileName}.pdf` : "document.pdf"
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`${label} downloaded`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to download PDF")
    } finally {
      setLoading(false)
    }
  }

  async function printPdf() {
    setLoading(true)
    try {
      const blob = await fetchPdf()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const iframe = document.createElement("iframe")
      iframe.style.display = "none"
      iframe.src = url
      document.body.appendChild(iframe)
      iframe.onload = () => {
        iframe.contentWindow?.print()
        setTimeout(() => {
          document.body.removeChild(iframe)
          URL.revokeObjectURL(url)
        }, 1000)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to print PDF")
    } finally {
      setLoading(false)
    }
  }

  if (iconOnly) {
    return (
      <Button
        variant="outline"
        size={size}
        onClick={downloadPdf}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors h-8">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {label}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={downloadPdf} disabled={loading}>
          <Download className="mr-2 h-4 w-4" />
          Download PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={printPdf} disabled={loading}>
          <Printer className="mr-2 h-4 w-4" />
          Print
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
