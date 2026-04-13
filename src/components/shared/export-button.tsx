"use client"

import { useCallback } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import * as XLSX from "xlsx"

export interface ExportColumn {
  key: string
  header: string
}

interface ExportButtonProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>[]
  columns: ExportColumn[]
  filename: string
  label?: string
}

export function ExportButton({
  data,
  columns,
  filename,
  label = "Export to Excel",
}: ExportButtonProps) {
  const handleExport = useCallback(() => {
    const rows = data.map((row) => {
      const mapped: Record<string, unknown> = {}
      for (const col of columns) {
        mapped[col.header] = row[col.key] ?? ""
      }
      return mapped
    })

    const ws = XLSX.utils.json_to_sheet(rows)

    // Auto-width columns
    const maxWidths = columns.map((col) => {
      const headerLen = col.header.length
      const maxDataLen = data.reduce((max, row) => {
        const val = String(row[col.key] ?? "")
        return Math.max(max, val.length)
      }, 0)
      return Math.min(Math.max(headerLen, maxDataLen) + 2, 40)
    })
    ws["!cols"] = maxWidths.map((w) => ({ wch: w }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Report")
    XLSX.writeFile(wb, `${filename}.xlsx`)
  }, [data, columns, filename])

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={data.length === 0}>
      <Download className="mr-1.5 h-3.5 w-3.5" />
      {label}
    </Button>
  )
}
