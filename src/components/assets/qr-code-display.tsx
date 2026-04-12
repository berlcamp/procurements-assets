"use client"

import { useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Download, Printer } from "lucide-react"

interface QRCodeDisplayProps {
  /** The property number to encode */
  propertyNumber: string
  /** Asset description for display context */
  description?: string | null
  /** Size of the QR code in pixels */
  size?: number
}

/**
 * Renders a QR code for an asset's property number.
 * Inline display variant — shows small QR with click-to-enlarge.
 */
export function QRCodeDisplay({
  propertyNumber,
  description,
  size = 80,
}: QRCodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, propertyNumber, {
        width: size,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      })
    }
  }, [propertyNumber, size])

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="inline-block rounded border p-1 hover:bg-muted transition-colors cursor-pointer"
        title="Click to enlarge QR code"
      >
        <canvas ref={canvasRef} />
      </button>

      <QRCodeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        propertyNumber={propertyNumber}
        description={description}
      />
    </>
  )
}

interface QRCodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  propertyNumber: string
  description?: string | null
}

/**
 * Full-screen dialog for viewing, downloading, and printing a QR code.
 */
export function QRCodeDialog({
  open,
  onOpenChange,
  propertyNumber,
  description,
}: QRCodeDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (open && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, propertyNumber, {
        width: 240,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      })
    }
  }, [open, propertyNumber])

  function handleDownload() {
    if (!canvasRef.current) return
    const url = canvasRef.current.toDataURL("image/png")
    const link = document.createElement("a")
    link.download = `QR-${propertyNumber}.png`
    link.href = url
    link.click()
  }

  function handlePrint() {
    if (!canvasRef.current) return
    const url = canvasRef.current.toDataURL("image/png")
    const printWindow = window.open("", "_blank")
    if (!printWindow) return
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>QR Code - ${propertyNumber}</title>
        <style>
          body {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            font-family: system-ui, sans-serif;
          }
          .label {
            margin-top: 16px;
            font-size: 14px;
            font-weight: 600;
            font-family: monospace;
          }
          .desc {
            margin-top: 4px;
            font-size: 12px;
            color: #666;
          }
        </style>
      </head>
      <body>
        <img src="${url}" width="240" height="240" />
        <div class="label">${propertyNumber}</div>
        ${description ? `<div class="desc">${description}</div>` : ""}
        <script>window.onload = () => { window.print(); window.close(); }<\/script>
      </body>
      </html>
    `)
    printWindow.document.close()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Asset QR Code</DialogTitle>
          <DialogDescription>
            Scan this QR code to identify asset <span className="font-mono font-semibold">{propertyNumber}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <canvas ref={canvasRef} className="rounded" />
          <p className="text-sm font-mono font-semibold">{propertyNumber}</p>
          {description && (
            <p className="text-xs text-muted-foreground text-center">{description}</p>
          )}
        </div>

        <div className="flex justify-center gap-3">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download PNG
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
