"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Upload, FileText, Eye, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import {
  setProcurementDocumentPath,
  type ProcurementDocumentType,
} from "@/lib/actions/procurement-activities"

interface ProcurementDocumentUploadProps {
  procurementId: string
  divisionId: string
  docType: ProcurementDocumentType
  /** Storage path already stored on procurement_activities, if any. */
  currentPath: string | null
  /** Disable uploads (e.g. procurement not at the right stage for this doc). */
  disabled?: boolean
  /** After a successful upload, allow a follow-up callback (e.g. closing a dialog). */
  onUploaded?: () => void
  /** Variant lets the caller render a compact single-button look. */
  variant?: "default" | "compact"
}

const BUCKET = "procurement-documents"

const EXT_RE = /\.([a-z0-9]+)$/i

export function ProcurementDocumentUpload({
  procurementId,
  divisionId,
  docType,
  currentPath,
  disabled = false,
  onUploaded,
  variant = "default",
}: ProcurementDocumentUploadProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [viewing, setViewing] = useState(false)

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    // Reset the input so the same file can be re-selected if upload fails
    event.target.value = ""

    if (file.size > 50 * 1024 * 1024) {
      toast.error("File is larger than 50 MB")
      return
    }

    setUploading(true)
    const supabase = createClient()

    const ext = (file.name.match(EXT_RE)?.[1] ?? "bin").toLowerCase()
    const path = `${divisionId}/${procurementId}/${docType}-${Date.now()}.${ext}`

    const { error: uploadError } = await supabase
      .storage
      .from(BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      })

    if (uploadError) {
      setUploading(false)
      toast.error(`Upload failed: ${uploadError.message}`)
      return
    }

    const result = await setProcurementDocumentPath({
      procurement_id: procurementId,
      doc_type:       docType,
      path,
    })

    setUploading(false)

    if (result.error) {
      // Best-effort cleanup of the orphaned object
      await supabase.storage.from(BUCKET).remove([path])
      toast.error(result.error)
      return
    }

    toast.success("File uploaded")
    onUploaded?.()
    router.refresh()
  }

  async function handleView() {
    if (!currentPath) return
    setViewing(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUrl(currentPath, 3600)
    setViewing(false)

    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not generate preview link")
      return
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer")
  }

  const hasFile = !!currentPath

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,image/png,image/jpeg,image/webp,.doc,.docx"
          onChange={handleFileChange}
          disabled={disabled || uploading}
        />
        {hasFile && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleView}
            disabled={viewing}
          >
            {viewing
              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              : <Eye className="mr-1 h-4 w-4" />}
            View
          </Button>
        )}
        <Button
          size="sm"
          variant={hasFile ? "outline" : "default"}
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading
            ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            : hasFile
              ? <FileText className="mr-1 h-4 w-4" />
              : <Upload className="mr-1 h-4 w-4" />}
          {hasFile ? "Replace" : "Upload"}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,image/png,image/jpeg,image/webp,.doc,.docx"
        onChange={handleFileChange}
        disabled={disabled || uploading}
      />
      {hasFile && (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-4 w-4" />
            File on record
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleView}
            disabled={viewing}
          >
            {viewing
              ? <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              : <Eye className="mr-1 h-4 w-4" />}
            View
          </Button>
        </>
      )}
      <Button
        size="sm"
        variant={hasFile ? "outline" : "default"}
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || uploading}
      >
        {uploading
          ? (<><Loader2 className="mr-1 h-4 w-4 animate-spin" />Uploading…</>)
          : hasFile
            ? (<><Upload className="mr-1 h-4 w-4" />Replace</>)
            : (<><Upload className="mr-1 h-4 w-4" />Upload</>)}
      </Button>
    </div>
  )
}
