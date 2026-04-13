"use client"

import { useState, useRef, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as XLSX from "xlsx"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Upload,
  FileSpreadsheet,
  ChevronLeft,
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  Info,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { useOffice } from "@/lib/hooks/use-office"
import { useFiscalYear } from "@/lib/hooks/use-fiscal-year"
import { importPpmpFromRows } from "@/lib/actions/documents"
import type { PpmpImportRow } from "@/lib/actions/documents"
import { cn } from "@/lib/utils"

// ─── Column mapping ────────────────────────────────────────────
// Expected columns in the template (case-insensitive trim)
const EXPECTED_COLUMNS = [
  "project_description",
  "project_type",
  "lot_title",
  "procurement_mode",
  "estimated_budget",
  "source_of_funds",
  "procurement_start",
  "procurement_end",
  "item_description",
  "unit",
  "quantity",
  "estimated_unit_cost",
  "specification",
] as const

type Step = "upload" | "preview" | "done"

function formatPeso(val: string | number): string {
  const n = typeof val === "string" ? parseFloat(val) : val
  if (isNaN(n)) return "—"
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2 })
}

function downloadTemplate() {
  const headers = [
    "project_description",
    "project_type",
    "lot_title",
    "procurement_mode",
    "estimated_budget",
    "source_of_funds",
    "procurement_start",
    "procurement_end",
    "item_description",
    "unit",
    "quantity",
    "estimated_unit_cost",
    "specification",
  ]
  const example = [
    "Office Supplies FY2025",
    "goods",
    "Lot 1 - Consumables",
    "svp",
    "25000",
    "MOOE",
    "2025-01-01",
    "2025-03-31",
    "Bond Paper A4 80gsm",
    "ream",
    "50",
    "500",
    "Short-sized, 80gsm",
  ]
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "PPMP Import")
  XLSX.writeFile(wb, "PPMP_Import_Template.xlsx")
}

export default function PpmpImportPage() {
  const router = useRouter()
  const { office } = useOffice()
  const { fiscalYear: activeFiscalYear } = useFiscalYear()

  const [step, setStep] = useState<Step>("upload")
  const [isDragging, setIsDragging] = useState(false)
  const [rows, setRows] = useState<PpmpImportRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ ppmpId: string | null; rowsImported: number; errors: string[] } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  function parseFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: "array" })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })

        const parsed: PpmpImportRow[] = []
        const errors: string[] = []

        raw.forEach((row, idx) => {
          // Normalize keys: lowercase + trim
          const normalized: Record<string, string> = {}
          for (const [k, v] of Object.entries(row)) {
            normalized[k.toLowerCase().trim().replace(/\s+/g, "_")] = String(v).trim()
          }

          const itemDesc = normalized.item_description
          const qty = normalized.quantity
          const unitCost = normalized.estimated_unit_cost
          const projectDesc = normalized.project_description
          const procMode = normalized.procurement_mode
          const budget = normalized.estimated_budget
          const projectType = normalized.project_type as PpmpImportRow["project_type"]

          if (!itemDesc) { errors.push(`Row ${idx + 2}: item_description is required`); return }
          if (!qty || isNaN(parseFloat(qty))) { errors.push(`Row ${idx + 2}: invalid quantity`); return }
          if (!unitCost || isNaN(parseFloat(unitCost))) { errors.push(`Row ${idx + 2}: invalid estimated_unit_cost`); return }
          if (!projectDesc) { errors.push(`Row ${idx + 2}: project_description is required`); return }
          if (!procMode) { errors.push(`Row ${idx + 2}: procurement_mode is required`); return }

          const validTypes = ["goods", "infrastructure", "consulting_services"]
          const finalType: PpmpImportRow["project_type"] = validTypes.includes(projectType) ? projectType : "goods"

          parsed.push({
            project_description: projectDesc,
            project_type: finalType,
            lot_title: normalized.lot_title || undefined,
            procurement_mode: procMode,
            estimated_budget: budget || String(parseFloat(unitCost) * parseFloat(qty)),
            source_of_funds: normalized.source_of_funds || undefined,
            procurement_start: normalized.procurement_start || undefined,
            procurement_end: normalized.procurement_end || undefined,
            item_description: itemDesc,
            unit: normalized.unit || "pc",
            quantity: qty,
            estimated_unit_cost: unitCost,
            specification: normalized.specification || undefined,
          })
        })

        setRows(parsed)
        setParseErrors(errors)
        setFileName(file.name)
        if (parsed.length > 0) {
          setStep("preview")
        } else if (errors.length > 0) {
          toast.error(`No valid rows found. ${errors.length} error(s) detected.`)
        } else {
          toast.error("The file appears to be empty or has no recognizable columns.")
        }
      } catch (err) {
        toast.error("Failed to parse file. Ensure it's a valid Excel or CSV file.")
        console.error(err)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) parseFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
    if (inputRef.current) inputRef.current.value = ""
  }

  async function handleImport() {
    if (!office?.id || !activeFiscalYear?.id) {
      toast.error("Office or fiscal year not found. Please set up your office first.")
      return
    }

    setImporting(true)
    try {
      const res = await importPpmpFromRows(rows, office.id, activeFiscalYear.id)
      setResult(res)
      setStep("done")
      if (res.ppmpId) {
        toast.success(`Import complete! ${res.rowsImported} item(s) imported.`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed")
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setStep("upload")
    setRows([])
    setParseErrors([])
    setFileName(null)
    setResult(null)
  }

  // Group rows by project + lot for preview display
  const grouped = rows.reduce<Map<string, { projectType: string; lots: Map<string, PpmpImportRow[]> }>>(
    (acc, row) => {
      const pk = `${row.project_description}||${row.project_type}`
      if (!acc.has(pk)) acc.set(pk, { projectType: row.project_type, lots: new Map() })
      const proj = acc.get(pk)!
      const lk = row.lot_title ?? "Default Lot"
      if (!proj.lots.has(lk)) proj.lots.set(lk, [])
      proj.lots.get(lk)!.push(row)
      return acc
    },
    new Map()
  )

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Import PPMPs</h1>
          <p className="text-sm text-muted-foreground">Bulk import from Excel or CSV template</p>
        </div>
        <Link href="/dashboard/planning/ppmp">
          <Button variant="outline" size="sm">
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to list
          </Button>
        </Link>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(["upload", "preview", "done"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-8 bg-border" />}
            <span className={cn(
              "rounded-full px-3 py-1 font-medium",
              step === s ? "bg-primary text-primary-foreground" :
              (i < (["upload", "preview", "done"] as const).indexOf(step)) ? "bg-muted text-muted-foreground" :
              "text-muted-foreground"
            )}>
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div className="space-y-4">
          {/* Info */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Download the Excel template, fill in your PPMP items, then upload the file here.
              Required columns: <code className="text-xs">project_description</code>,{" "}
              <code className="text-xs">item_description</code>,{" "}
              <code className="text-xs">quantity</code>,{" "}
              <code className="text-xs">estimated_unit_cost</code>,{" "}
              <code className="text-xs">procurement_mode</code>
            </AlertDescription>
          </Alert>

          <Button variant="outline" onClick={downloadTemplate} className="gap-2">
            <Download className="h-4 w-4" />
            Download Template (.xlsx)
          </Button>

          {/* Dropzone */}
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center cursor-pointer transition-colors",
              isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/40 hover:bg-muted/20"
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground" />
            <div>
              <p className="font-medium">Drop your Excel / CSV file here</p>
              <p className="text-sm text-muted-foreground">or click to browse</p>
            </div>
            <p className="text-xs text-muted-foreground">Supports .xlsx, .xls, .csv</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleInputChange}
          />
        </div>
      )}

      {/* Step 2: Preview */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">{fileName}</span>
              <Badge>{rows.length} item{rows.length !== 1 ? "s" : ""} found</Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={reset}>
              <X className="mr-1 h-4 w-4" />
              Change file
            </Button>
          </div>

          {/* Parse errors */}
          {parseErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium mb-1">{parseErrors.length} row(s) skipped due to errors:</p>
                <ul className="list-disc list-inside text-sm space-y-0.5">
                  {parseErrors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Context info */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3 text-sm">
              <p className="text-muted-foreground">Office</p>
              <p className="font-medium">{office?.name ?? "—"}</p>
            </div>
            <div className="rounded-lg border p-3 text-sm">
              <p className="text-muted-foreground">Fiscal Year</p>
              <p className="font-medium">{activeFiscalYear?.year ?? "—"}</p>
            </div>
          </div>

          {/* Preview grouped by project/lot */}
          <div className="space-y-4">
            {Array.from(grouped.entries()).map(([pk, { projectType, lots }]) => {
              const [projectDesc] = pk.split("||")
              return (
                <Card key={pk}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm">{projectDesc}</CardTitle>
                      <Badge variant="outline" className="capitalize shrink-0">
                        {projectType.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {Array.from(lots.entries()).map(([lotTitle, items]) => (
                      <div key={lotTitle}>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          {lotTitle} — Mode: {items[0].procurement_mode} — Budget: ₱{formatPeso(items[0].estimated_budget)}
                        </p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Description</TableHead>
                              <TableHead className="text-xs w-16 text-center">Unit</TableHead>
                              <TableHead className="text-xs w-16 text-right">Qty</TableHead>
                              <TableHead className="text-xs w-24 text-right">Unit Cost</TableHead>
                              <TableHead className="text-xs w-24 text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {items.map((item, i) => (
                              <TableRow key={i}>
                                <TableCell className="text-xs">{item.item_description}</TableCell>
                                <TableCell className="text-xs text-center">{item.unit}</TableCell>
                                <TableCell className="text-xs text-right">{item.quantity}</TableCell>
                                <TableCell className="text-xs text-right">{formatPeso(item.estimated_unit_cost)}</TableCell>
                                <TableCell className="text-xs text-right">
                                  {formatPeso(String(parseFloat(item.quantity) * parseFloat(item.estimated_unit_cost)))}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleImport}
              disabled={importing || !office?.id || !activeFiscalYear?.id}
              className="gap-2"
            >
              {importing && <Loader2 className="h-4 w-4 animate-spin" />}
              {importing ? "Importing…" : `Import ${rows.length} Item${rows.length !== 1 ? "s" : ""}`}
            </Button>
            <Button variant="outline" onClick={reset}>
              Cancel
            </Button>
            {(!office?.id || !activeFiscalYear?.id) && (
              <p className="text-sm text-destructive">Office or fiscal year not detected.</p>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === "done" && result && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            {result.ppmpId ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <CheckCircle className="h-12 w-12 text-green-500" />
                <div>
                  <h2 className="text-lg font-semibold">Import Successful</h2>
                  <p className="text-sm text-muted-foreground">
                    {result.rowsImported} item{result.rowsImported !== 1 ? "s" : ""} imported into a new PPMP draft.
                  </p>
                </div>
                {result.errors.length > 0 && (
                  <Alert className="text-left">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <p className="font-medium">{result.errors.length} item(s) had errors and were skipped:</p>
                      <ul className="list-disc list-inside text-xs mt-1 space-y-0.5">
                        {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                        {result.errors.length > 5 && <li>…and {result.errors.length - 5} more</li>}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex gap-3">
                  <Link href={`/dashboard/planning/ppmp/${result.ppmpId}`}>
                    <Button>Open PPMP</Button>
                  </Link>
                  <Button variant="outline" onClick={reset}>Import Another</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertCircle className="h-12 w-12 text-destructive" />
                <div>
                  <h2 className="text-lg font-semibold">Import Failed</h2>
                  <p className="text-sm text-muted-foreground">
                    {result.errors[0] ?? "An unknown error occurred."}
                  </p>
                </div>
                <Button variant="outline" onClick={reset}>Try Again</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
