"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Check, Trash2, ExternalLink, AlertTriangle, ShieldCheck, Pencil } from "lucide-react"
import { toast } from "sonner"
import { format, isPast, parseISO } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  addSupplierDocument,
  verifySupplierDocument,
  unverifySupplierDocument,
  deleteSupplierDocument,
} from "@/lib/actions/supplier-documents"
import type { SupplierDocument, SupplierDocumentType } from "@/types/database"
import { cn } from "@/lib/utils"

interface SupplierDocumentsCardProps {
  supplierId: string
  documents: SupplierDocument[]
  documentTypes: SupplierDocumentType[]
  canManage: boolean
  canVerify: boolean
}

type DocStatus = "verified" | "pending" | "expired" | "missing"

function statusForDoc(doc: SupplierDocument | undefined): DocStatus {
  if (!doc) return "missing"
  if (doc.expiry_date && isPast(parseISO(doc.expiry_date))) return "expired"
  if (!doc.verified_at) return "pending"
  return "verified"
}

const STATUS_BADGE: Record<DocStatus, { label: string; className: string }> = {
  verified: { label: "Verified", className: "border-green-400 text-green-700 bg-green-50" },
  pending:  { label: "Awaiting verification", className: "border-amber-400 text-amber-700 bg-amber-50" },
  expired:  { label: "Expired", className: "border-red-400 text-red-700 bg-red-50" },
  missing:  { label: "Missing", className: "border-red-400 text-red-700 bg-red-50" },
}

export function SupplierDocumentsCard({
  supplierId,
  documents,
  documentTypes,
  canManage,
  canVerify,
}: SupplierDocumentsCardProps) {
  const router = useRouter()
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Group docs by type → most relevant doc per type (latest verified or latest by expiry)
  const latestByType = new Map<string, SupplierDocument>()
  for (const doc of documents) {
    const existing = latestByType.get(doc.document_type)
    if (!existing) {
      latestByType.set(doc.document_type, doc)
      continue
    }
    // Prefer verified, then later expiry
    const existingScore =
      (existing.verified_at ? 2 : 0) +
      (existing.expiry_date && !isPast(parseISO(existing.expiry_date)) ? 1 : 0)
    const docScore =
      (doc.verified_at ? 2 : 0) +
      (doc.expiry_date && !isPast(parseISO(doc.expiry_date)) ? 1 : 0)
    if (docScore > existingScore) latestByType.set(doc.document_type, doc)
  }

  // Build per-method readiness
  const svpRequired = documentTypes.filter(t => t.required_for_svp)
  const biddingRequired = documentTypes.filter(t => t.required_for_bidding)

  function checklistFor(required: SupplierDocumentType[]) {
    return required.map(t => {
      const doc = latestByType.get(t.code)
      return { type: t, doc, status: statusForDoc(doc) }
    })
  }

  const svpChecklist = checklistFor(svpRequired)
  const biddingChecklist = checklistFor(biddingRequired)

  const svpReady = svpChecklist.every(c => c.status === "verified")
  const biddingReady = biddingChecklist.every(c => c.status === "verified")

  async function handleVerify(docId: string) {
    setBusy(true)
    const result = await verifySupplierDocument(docId, supplierId)
    setBusy(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Document verified")
    router.refresh()
  }

  async function handleUnverify(docId: string) {
    setBusy(true)
    const result = await unverifySupplierDocument(docId, supplierId)
    setBusy(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Verification removed")
    router.refresh()
  }

  async function handleDelete(docId: string) {
    if (!confirm("Delete this document? This cannot be undone.")) return
    setBusy(true)
    const result = await deleteSupplierDocument(docId, supplierId)
    setBusy(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Document removed")
    router.refresh()
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Eligibility Documents
          </CardTitle>
          {canManage && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Document
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Readiness summary */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div
            className={cn(
              "rounded-md border p-3 text-sm flex items-center gap-2",
              svpReady ? "border-green-300 bg-green-50 text-green-800" : "border-amber-300 bg-amber-50 text-amber-800"
            )}
          >
            {svpReady ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <div>
              <p className="font-medium">SVP / Shopping</p>
              <p className="text-xs">{svpReady ? "Ready to bid" : "Missing or expired documents"}</p>
            </div>
          </div>
          <div
            className={cn(
              "rounded-md border p-3 text-sm flex items-center gap-2",
              biddingReady ? "border-green-300 bg-green-50 text-green-800" : "border-amber-300 bg-amber-50 text-amber-800"
            )}
          >
            {biddingReady ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <div>
              <p className="font-medium">Competitive Bidding</p>
              <p className="text-xs">{biddingReady ? "Ready to bid" : "Missing or expired documents"}</p>
            </div>
          </div>
        </div>

        {/* Required-doc checklist */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Required Documents
          </p>
          <div className="space-y-1">
            {documentTypes.map(t => {
              const doc = latestByType.get(t.code)
              const status = statusForDoc(doc)
              const badge = STATUS_BADGE[status]
              return (
                <div key={t.code} className="flex items-center justify-between gap-3 rounded border p-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{t.display_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.required_for_bidding && t.required_for_svp
                        ? "Required for SVP + Bidding"
                        : t.required_for_bidding
                          ? "Required for Bidding only"
                          : "Required for SVP only"}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("shrink-0", badge.className)}>
                    {badge.label}
                  </Badge>
                </div>
              )
            })}
          </div>
        </div>

        {/* Existing documents table */}
        {documents.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              On File
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map(doc => {
                  const type = documentTypes.find(t => t.code === doc.document_type)
                  const status = statusForDoc(doc)
                  const badge = STATUS_BADGE[status]
                  return (
                    <TableRow key={doc.id}>
                      <TableCell className="text-sm">
                        <div className="font-medium">{type?.display_name ?? doc.document_type}</div>
                        {doc.issuing_authority && (
                          <div className="text-xs text-muted-foreground">{doc.issuing_authority}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-mono text-xs">
                        {doc.document_number ?? "—"}
                        {doc.document_url && (
                          <a
                            href={doc.document_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-1 inline-flex items-center text-blue-600 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {doc.issue_date ? format(parseISO(doc.issue_date), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {doc.expiry_date ? format(parseISO(doc.expiry_date), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={badge.className}>
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {canVerify && status !== "expired" && (
                            doc.verified_at ? (
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground"
                                title="Remove verification"
                                onClick={() => handleUnverify(doc.id)}
                                disabled={busy}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-green-600"
                                title="Verify"
                                onClick={() => handleVerify(doc.id)}
                                disabled={busy}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            )
                          )}
                          {canManage && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Delete"
                              onClick={() => handleDelete(doc.id)}
                              disabled={busy}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <AddDocumentDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          supplierId={supplierId}
          documentTypes={documentTypes}
          onSuccess={() => router.refresh()}
        />
      </CardContent>
    </Card>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Add document dialog
// ────────────────────────────────────────────────────────────────────────────

interface AddDocumentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  supplierId: string
  documentTypes: SupplierDocumentType[]
  onSuccess: () => void
}

function AddDocumentDialog({ open, onOpenChange, supplierId, documentTypes, onSuccess }: AddDocumentDialogProps) {
  const [busy, setBusy] = useState(false)
  const [docType, setDocType] = useState("")
  const [docNumber, setDocNumber] = useState("")
  const [docUrl, setDocUrl] = useState("")
  const [issuer, setIssuer] = useState("")
  const [issueDate, setIssueDate] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [notes, setNotes] = useState("")

  function reset() {
    setDocType("")
    setDocNumber("")
    setDocUrl("")
    setIssuer("")
    setIssueDate("")
    setExpiryDate("")
    setNotes("")
  }

  function handleOpen(next: boolean) {
    onOpenChange(next)
    if (next) reset()
  }

  async function handleSave() {
    if (!docType) {
      toast.error("Select a document type")
      return
    }
    setBusy(true)
    const result = await addSupplierDocument(supplierId, {
      document_type:     docType,
      document_number:   docNumber || null,
      document_url:      docUrl || null,
      issuing_authority: issuer || null,
      issue_date:        issueDate || null,
      expiry_date:       expiryDate || null,
      notes:             notes || null,
    })
    setBusy(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Document added")
    onOpenChange(false)
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Eligibility Document</DialogTitle>
          <DialogDescription>
            Document must be verified by BAC Secretariat / BAC Chair before the supplier can bid.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label>Document Type *</Label>
            <select
              value={docType}
              onChange={e => setDocType(e.target.value)}
              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {documentTypes.map(t => (
                <option key={t.code} value={t.code}>
                  {t.display_name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Document Number</Label>
              <Input value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder="e.g. PR-2026-1234" />
            </div>
            <div>
              <Label>Issuing Authority</Label>
              <Input value={issuer} onChange={e => setIssuer(e.target.value)} placeholder="e.g. BIR, City of Cebu" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Issue Date</Label>
              <Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
            </div>
            <div>
              <Label>Expiry Date</Label>
              <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Document URL (optional)</Label>
            <Input
              type="url"
              value={docUrl}
              onChange={e => setDocUrl(e.target.value)}
              placeholder="Link to scanned PDF in your file storage"
            />
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional remarks"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy || !docType}>
            {busy ? "Saving…" : "Add Document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
