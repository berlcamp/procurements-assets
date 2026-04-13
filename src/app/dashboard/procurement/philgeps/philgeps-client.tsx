"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import * as XLSX from "xlsx"
import { Globe, Download, Copy, ExternalLink, Search, Filter, CheckCircle, Clock, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"
import type { PhilGepsEntry } from "@/lib/actions/documents"
import type { FiscalYear } from "@/types/database"
import { format } from "date-fns"

const METHOD_LABELS: Record<string, string> = {
  competitive_bidding: "Competitive Bidding",
  shopping: "Shopping",
  svp: "SVP",
  direct_contracting: "Direct Contracting",
  repeat_order: "Repeat Order",
  emergency: "Emergency",
  negotiated: "Negotiated",
  agency_to_agency: "Agency-to-Agency",
}

function formatPeso(val: string | number | null): string {
  if (val === null || val === undefined) return "—"
  const n = typeof val === "string" ? parseFloat(val) : val
  if (isNaN(n)) return "—"
  return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
}

function PostingStatus({ entry }: { entry: PhilGepsEntry }) {
  if (entry.philgeps_reference) {
    return (
      <div className="flex items-center gap-1.5 text-green-700">
        <CheckCircle className="h-3.5 w-3.5" />
        <span className="text-xs font-mono">{entry.philgeps_reference}</span>
      </div>
    )
  }
  if (entry.posting_date) {
    return (
      <div className="flex items-center gap-1.5 text-amber-700">
        <Clock className="h-3.5 w-3.5" />
        <span className="text-xs">Posted {format(new Date(entry.posting_date), "MMM d")}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <AlertCircle className="h-3.5 w-3.5" />
      <span className="text-xs">Not yet posted</span>
    </div>
  )
}

interface Props {
  entries: PhilGepsEntry[]
  fiscalYears: FiscalYear[]
}

export function PhilGepsClient({ entries, fiscalYears }: Props) {
  const [search, setSearch] = useState("")
  const [methodFilter, setMethodFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [fyFilter, setFyFilter] = useState("all")

  const filtered = useMemo(() => {
    let result = entries

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.procurement_number.toLowerCase().includes(q) ||
        e.office.toLowerCase().includes(q) ||
        (e.philgeps_reference?.toLowerCase().includes(q) ?? false)
      )
    }

    if (methodFilter !== "all") {
      result = result.filter(e => e.procurement_method === methodFilter)
    }

    if (statusFilter === "posted") {
      result = result.filter(e => !!e.philgeps_reference)
    } else if (statusFilter === "pending") {
      result = result.filter(e => !e.philgeps_reference)
    }

    if (fyFilter !== "all") {
      result = result.filter(e => String(e.fiscal_year) === fyFilter)
    }

    return result
  }, [entries, search, methodFilter, statusFilter, fyFilter])

  function copyRow(entry: PhilGepsEntry) {
    const text = [
      `Procurement No.: ${entry.procurement_number}`,
      `Title: ${entry.title}`,
      `Method: ${METHOD_LABELS[entry.procurement_method] ?? entry.procurement_method}`,
      `ABC: ${formatPeso(entry.abc_amount)}`,
      `Posting Date: ${entry.posting_date ? format(new Date(entry.posting_date), "MMM d, yyyy") : "—"}`,
      `Deadline: ${entry.submission_deadline ? format(new Date(entry.submission_deadline), "MMM d, yyyy") : "—"}`,
      `Office: ${entry.office}`,
      `FY: ${entry.fiscal_year}`,
    ].join("\n")

    navigator.clipboard.writeText(text).then(() => {
      toast.success("Copied to clipboard")
    })
  }

  function exportToExcel() {
    const data = filtered.map(e => ({
      "Procurement No.": e.procurement_number,
      "Title / Purpose": e.title,
      "Method": METHOD_LABELS[e.procurement_method] ?? e.procurement_method,
      "ABC (PHP)": parseFloat(e.abc_amount),
      "Posting Date": e.posting_date ?? "",
      "Deadline": e.submission_deadline ?? "",
      "Contract Amount (PHP)": e.contract_amount ? parseFloat(e.contract_amount) : "",
      "Awarded Supplier": e.awarded_supplier ?? "",
      "PhilGEPS Reference": e.philgeps_reference ?? "",
      "Office": e.office,
      "FY": e.fiscal_year,
    }))

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "PhilGEPS Data")
    XLSX.writeFile(wb, `PhilGEPS_Data_FY${fyFilter !== "all" ? fyFilter : "All"}.xlsx`)
    toast.success("Exported to Excel")
  }

  const postedCount = filtered.filter(e => !!e.philgeps_reference).length
  const pendingCount = filtered.filter(e => !e.philgeps_reference).length

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold">{filtered.length}</p>
            <p className="text-sm text-muted-foreground">Total Procurements</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-green-600">{postedCount}</p>
            <p className="text-sm text-muted-foreground">With PhilGEPS Reference</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
            <p className="text-sm text-muted-foreground">Pending Posting</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by title, number, office…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <Select value={methodFilter} onValueChange={(v) => setMethodFilter(v ?? "all")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All methods" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            <SelectItem value="competitive_bidding">Competitive Bidding</SelectItem>
            <SelectItem value="shopping">Shopping</SelectItem>
            <SelectItem value="svp">SVP</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>

        {fiscalYears.length > 0 && (
          <Select value={fyFilter} onValueChange={(v) => setFyFilter(v ?? "all")}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="All FYs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All FYs</SelectItem>
              {fiscalYears.map(fy => (
                <SelectItem key={fy.id} value={String(fy.year)}>FY {fy.year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-2 ml-auto">
          <Download className="h-4 w-4" />
          Export Excel
        </Button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Globe className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p>No procurement activities found for PhilGEPS.</p>
          <p className="text-sm mt-1">Competitive Bidding, Shopping, and SVP procurement methods require PhilGEPS posting.</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Procurement No.</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">ABC</TableHead>
                  <TableHead>Posting Date</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>PhilGEPS Status</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(entry => (
                  <TableRow key={entry.procurement_id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/dashboard/procurement/activities/${entry.procurement_id}`}
                        className="text-primary hover:underline flex items-center gap-1"
                      >
                        {entry.procurement_number}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <p className="truncate text-sm">{entry.title}</p>
                      <p className="text-xs text-muted-foreground">{entry.office}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {METHOD_LABELS[entry.procurement_method] ?? entry.procurement_method}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {formatPeso(entry.abc_amount)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.posting_date
                        ? format(new Date(entry.posting_date), "MMM d, yyyy")
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.submission_deadline
                        ? format(new Date(entry.submission_deadline), "MMM d, yyyy")
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <PostingStatus entry={entry} />
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => copyRow(entry)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy data for PhilGEPS</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card className="bg-muted/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">How to Post on PhilGEPS</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            <li>Log in to <strong>philgeps.gov.ph</strong> using your agency account.</li>
            <li>Navigate to <strong>Procurement Opportunities → Create Opportunity</strong>.</li>
            <li>Use the <Copy className="inline h-3 w-3" /> Copy button above to copy procurement details.</li>
            <li>Fill in the PhilGEPS form with the copied data (title, ABC, deadline, etc.).</li>
            <li>After successful posting, copy the <strong>PhilGEPS Reference No.</strong> generated.</li>
            <li>Return to the Procurement Activity in PABMS and enter the reference number.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
