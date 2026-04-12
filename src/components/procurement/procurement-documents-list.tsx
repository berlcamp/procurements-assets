"use client"

import { useState } from "react"
import { Download, Eye, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { format } from "date-fns"

const BUCKET = "procurement-documents"

interface DocumentEntry {
  key: string
  label: string
  path: string | null
  uploadedAt: string | null
  meta?: string | null
}

interface ProcurementDocumentsListProps {
  documents: DocumentEntry[]
}

export function ProcurementDocumentsList({ documents }: ProcurementDocumentsListProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null)

  async function generateSignedUrl(path: string, forceDownload: boolean): Promise<string | null> {
    const supabase = createClient()
    const { data, error } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUrl(path, 3600, forceDownload ? { download: true } : undefined)

    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not generate file link")
      return null
    }
    return data.signedUrl
  }

  async function handleView(entry: DocumentEntry) {
    if (!entry.path) return
    setBusyKey(`view-${entry.key}`)
    const url = await generateSignedUrl(entry.path, false)
    setBusyKey(null)
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }

  async function handleDownload(entry: DocumentEntry) {
    if (!entry.path) return
    setBusyKey(`dl-${entry.key}`)
    const url = await generateSignedUrl(entry.path, true)
    setBusyKey(null)
    if (url) {
      // Use a hidden anchor so the browser honors Content-Disposition
      const a = document.createElement("a")
      a.href = url
      a.rel = "noopener noreferrer"
      a.click()
    }
  }

  const uploaded = documents.filter(d => !!d.path)

  if (uploaded.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-3 text-center">
        No documents uploaded yet.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {uploaded.map(entry => {
        const isViewing = busyKey === `view-${entry.key}`
        const isDownloading = busyKey === `dl-${entry.key}`
        return (
          <li
            key={entry.key}
            className="rounded-md border bg-background px-2.5 py-2"
          >
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{entry.label}</p>
                {entry.meta && (
                  <p className="text-[11px] text-muted-foreground truncate">{entry.meta}</p>
                )}
                {entry.uploadedAt && (
                  <p className="text-[11px] text-muted-foreground">
                    Uploaded {format(new Date(entry.uploadedAt), "MMM d, yyyy h:mm a")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-1.5 mt-1.5 justify-end">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => handleView(entry)}
                disabled={!!busyKey}
              >
                {isViewing
                  ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  : <Eye className="mr-1 h-3 w-3" />}
                View
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => handleDownload(entry)}
                disabled={!!busyKey}
              >
                {isDownloading
                  ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  : <Download className="mr-1 h-3 w-3" />}
                Download
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
