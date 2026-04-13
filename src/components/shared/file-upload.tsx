"use client"

import { useRef, useState } from "react"
import { Upload, X, CheckCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export interface UploadedFile {
  name: string
  size: number
  path: string
  url: string
}

interface FileUploadProps {
  /** Accepted MIME types e.g. "application/pdf,.pdf,.xlsx" */
  accept?: string
  /** Max file size in bytes (default 50MB) */
  maxSize?: number
  /** Called when upload completes */
  onUpload?: (file: UploadedFile) => void
  /** Called when file is removed */
  onRemove?: () => void
  /** Custom upload handler (receives File, returns { path, url }) */
  uploadHandler?: (file: File) => Promise<{ path: string; url: string }>
  /** Currently uploaded file (controlled) */
  value?: UploadedFile | null
  /** Label shown above the dropzone */
  label?: string
  /** Help text below label */
  hint?: string
  className?: string
  disabled?: boolean
}

const DEFAULT_MAX = 50 * 1024 * 1024 // 50MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileUpload({
  accept = "application/pdf,.pdf,.xlsx,.xls,.csv,.doc,.docx,.jpg,.jpeg,.png",
  maxSize = DEFAULT_MAX,
  onUpload,
  onRemove,
  uploadHandler,
  value,
  label,
  hint,
  className,
  disabled = false,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  async function handleFile(file: File) {
    if (file.size > maxSize) {
      toast.error(`File too large. Maximum size: ${formatBytes(maxSize)}`)
      return
    }

    if (!uploadHandler) {
      // No handler provided — just call onUpload with a local object URL
      const url = URL.createObjectURL(file)
      onUpload?.({ name: file.name, size: file.size, path: file.name, url })
      return
    }

    setUploading(true)
    setProgress(10)
    try {
      // Simulate progress since fetch doesn't expose upload progress easily
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 15, 85))
      }, 300)

      const result = await uploadHandler(file)
      clearInterval(progressInterval)
      setProgress(100)

      onUpload?.({ name: file.name, size: file.size, ...result })
      toast.success("File uploaded successfully")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
      setProgress(0)
    } finally {
      setUploading(false)
      setTimeout(() => setProgress(0), 800)
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset input so same file can be re-selected
    if (inputRef.current) inputRef.current.value = ""
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    if (disabled) return
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  function remove() {
    onRemove?.()
  }

  if (value) {
    return (
      <div className={cn("flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3", className)}>
        <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{value.name}</p>
          <p className="text-xs text-muted-foreground">{formatBytes(value.size)}</p>
        </div>
        {!disabled && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={remove}
            type="button"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <div>
          <p className="text-sm font-medium">{label}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      )}

      <div
        className={cn(
          "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors cursor-pointer",
          isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30",
          disabled && "pointer-events-none opacity-50"
        )}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        {uploading ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Uploading…</p>
            {progress > 0 && (
              <div className="h-1.5 w-32 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                Drop file here or <span className="text-primary">browse</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Max {formatBytes(maxSize)} · PDF, Excel, Word, Images
              </p>
            </div>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={onInputChange}
        disabled={disabled || uploading}
      />
    </div>
  )
}
