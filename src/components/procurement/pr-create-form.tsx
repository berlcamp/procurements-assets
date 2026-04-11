"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { AlertTriangle, Check } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { AmountDisplay, formatPeso } from "@/components/shared/amount-display"
import { PrItemsEdit } from "@/components/procurement/pr-items-table"
import { createPrSchema, type CreatePrInput } from "@/lib/schemas/procurement"
import { createPurchaseRequest, getApprovedAppItemsForOffice, checkSplitContract } from "@/lib/actions/procurement"
import type { FiscalYear, Office, AppItem, AppLot, PpmpLotItem } from "@/types/database"
import { cn } from "@/lib/utils"

type PpmpLotItemPick = Pick<PpmpLotItem, 'id' | 'item_number' | 'description' | 'quantity' | 'unit' | 'estimated_unit_cost' | 'estimated_total_cost' | 'specification'>

type AppItemWithLot = AppItem & {
  lot?: Pick<AppLot, "id" | "lot_name" | "lot_number"> | null
  source_ppmp_lot?: { ppmp_lot_items: PpmpLotItemPick[] } | null
  ppmp_creator_name?: string | null
  has_active_pr?: boolean
}

interface PrCreateFormProps {
  fiscalYear: FiscalYear
  offices: Office[]
}

// Normalize legacy procurement_mode strings to canonical keys
function normalizeMode(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().trim()
  if (s === "small value procurement" || s === "svp") return "svp"
  if (s === "shopping") return "shopping"
  if (s === "public bidding" || s === "competitive bidding" || s === "bidding") return "competitive_bidding"
  return s
}

// RA 12009 ceilings (mirrors procurement_method_ceilings table)
const MODE_CEILINGS: Record<string, number | null> = {
  svp:                 1_000_000,
  shopping:            1_000_000,
  competitive_bidding: null,
  direct_contracting:  null,
  repeat_order:        null,
  emergency:           null,
  negotiated:          null,
  agency_to_agency:    null,
}

const MODE_LABELS: Record<string, string> = {
  svp:                 "Small Value Procurement",
  shopping:            "Shopping",
  competitive_bidding: "Competitive Bidding",
  direct_contracting:  "Direct Contracting",
  repeat_order:        "Repeat Order",
  emergency:           "Emergency Purchase",
  negotiated:          "Negotiated Procurement",
  agency_to_agency:    "Agency-to-Agency",
}

export function PrCreateForm({ fiscalYear, offices }: PrCreateFormProps) {
  const router = useRouter()
  const [appItems, setAppItems] = useState<AppItemWithLot[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [splitWarning, setSplitWarning] = useState(false)

  const form = useForm<CreatePrInput>({
    resolver: zodResolver(createPrSchema),
    defaultValues: {
      office_id: offices.length === 1 ? offices[0].id : "",
      fiscal_year_id: fiscalYear.id,
      purpose: "",
      items: [],
    },
  })

  const watchOfficeId = useWatch({ control: form.control, name: "office_id" })
  const watchItems    = useWatch({ control: form.control, name: "items" }) ?? []

  // Load APP items when office changes
  useEffect(() => {
    if (!watchOfficeId) {
      setAppItems([])
      setSelectedIds([])
      form.setValue("items", [])
      return
    }
    setLoadingItems(true)
    getApprovedAppItemsForOffice(watchOfficeId, fiscalYear.id)
      .then(items => setAppItems(items as AppItemWithLot[]))
      .finally(() => setLoadingItems(false))
  }, [watchOfficeId, fiscalYear.id, form])

  // Selected APP items, in selection order
  const selectedItems = useMemo(
    () => selectedIds
      .map(id => appItems.find(i => i.id === id))
      .filter((i): i is AppItemWithLot => Boolean(i)),
    [selectedIds, appItems]
  )

  // Unified mode is the mode of the first selected item; subsequent items must match
  const unifiedMode = useMemo(() => {
    if (selectedItems.length === 0) return null
    return normalizeMode(selectedItems[0].procurement_mode)
  }, [selectedItems])

  const ceiling = unifiedMode ? MODE_CEILINGS[unifiedMode] ?? null : null

  // Sync selected items into the form's items array as draft line rows.
  // Each selected APP item expands into its PPMP lot items (one PR line per lot item).
  // Falls back to a single line from general_description when no lot items exist.
  useEffect(() => {
    if (selectedItems.length === 0) {
      if (watchItems.length > 0) form.setValue("items", [])
      return
    }
    // Build a lookup of existing edits keyed by "appItemId::description" to preserve user edits
    const existingKey = (row: { app_item_id: string; description: string }) =>
      `${row.app_item_id}::${row.description}`
    const existingMap = new Map(
      watchItems.filter(it => it.app_item_id).map(it => [existingKey(it), it])
    )

    let lineNumber = 0
    const next: CreatePrInput["items"] = []

    for (const item of selectedItems) {
      const lotItems = item.source_ppmp_lot?.ppmp_lot_items ?? []

      if (lotItems.length > 0) {
        // Expand each PPMP lot item into its own PR line item
        for (const li of lotItems) {
          lineNumber++
          const key = `${item.id}::${li.description}`
          const existing = existingMap.get(key)
          if (existing) {
            next.push({ ...existing, item_number: lineNumber })
          } else {
            next.push({
              item_number: lineNumber,
              app_item_id: item.id,
              description: li.description,
              unit: li.unit,
              quantity: String(li.quantity ?? "1"),
              estimated_unit_cost: String(li.estimated_unit_cost ?? "0"),
              remarks: null,
            })
          }
        }
      } else {
        // Fallback: no lot items — create one line from the APP item itself
        lineNumber++
        const key = `${item.id}::${item.general_description}`
        const existing = existingMap.get(key)
        if (existing) {
          next.push({ ...existing, item_number: lineNumber })
        } else {
          next.push({
            item_number: lineNumber,
            app_item_id: item.id,
            description: item.general_description,
            unit: "",
            quantity: "1",
            estimated_unit_cost: String(item.estimated_budget ?? "0"),
            remarks: null,
          })
        }
      }
    }

    form.setValue("items", next, { shouldValidate: false, shouldDirty: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItems])

  // Split-contract advisory check (uses first item's project_type)
  useEffect(() => {
    if (!watchOfficeId || selectedItems.length === 0) {
      setSplitWarning(false)
      return
    }
    const total = watchItems.reduce((sum, i) => {
      const q = parseFloat(i.quantity || "0")
      const c = parseFloat(i.estimated_unit_cost || "0")
      return sum + (isNaN(q) || isNaN(c) ? 0 : q * c)
    }, 0)
    if (total <= 0) {
      setSplitWarning(false)
      return
    }
    checkSplitContract(watchOfficeId, selectedItems[0].project_type ?? "goods", total)
      .then(w => setSplitWarning(w?.warning ?? false))
  }, [watchItems, watchOfficeId, selectedItems])

  function toggleItem(item: AppItemWithLot) {
    if (item.has_active_pr) return
    const itemMode = normalizeMode(item.procurement_mode)
    if (unifiedMode && itemMode !== unifiedMode) return
    setSelectedIds(prev =>
      prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id]
    )
  }

  async function onSubmit(data: CreatePrInput) {
    const result = await createPurchaseRequest(data)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Purchase Request created")
    router.push(`/dashboard/procurement/purchase-requests/${result.id}`)
  }

  const grandTotal = watchItems.reduce((sum, i) => {
    const q = parseFloat(i.quantity || "0")
    const c = parseFloat(i.estimated_unit_cost || "0")
    return sum + (isNaN(q) || isNaN(c) ? 0 : q * c)
  }, 0)

  const ceilingExceeded = ceiling !== null && grandTotal > ceiling

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {ceilingExceeded && (
          <Alert className="border-red-400 bg-red-50">
            <AlertDescription className="text-red-800">
              <strong>ABC Ceiling Exceeded:</strong> Bundled total of{" "}
              <strong>{formatPeso(grandTotal)}</strong> exceeds the {MODE_LABELS[unifiedMode!]} ceiling of{" "}
              <strong>{formatPeso(ceiling!)}</strong>. Use Competitive Bidding instead, or remove items.
            </AlertDescription>
          </Alert>
        )}
        {splitWarning && (
          <Alert className="border-yellow-400 bg-yellow-50">
            <AlertDescription className="text-yellow-800">
              <strong>Split Contract Advisory:</strong> Cumulative PRs from this office may approach the
              ceiling for this category. Ensure this does not constitute contract splitting under RA 12009.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: Request details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Request Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="office_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Office *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    items={Object.fromEntries(offices.map(o => [o.id, o.name]))}
                  >
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select office" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {offices.map(o => (
                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <div>
                <p className="text-sm font-medium">Fiscal Year</p>
                <p className="text-sm text-muted-foreground mt-1">{fiscalYear.year}</p>
              </div>

              <FormField control={form.control} name="purpose" render={({ field }) => (
                <FormItem>
                  <FormLabel>Purpose *</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="State the purpose of this purchase request (min 10 chars)" rows={3} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Bundle summary */}
              {selectedItems.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bundled Items</span>
                    <span className="font-semibold">{selectedItems.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Procurement Mode</span>
                    <span className="font-semibold">{unifiedMode ? MODE_LABELS[unifiedMode] ?? unifiedMode : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bundled Total</span>
                    <AmountDisplay
                      amount={grandTotal.toString()}
                      className={cn("font-semibold", ceilingExceeded && "text-red-600")}
                    />
                  </div>
                  {ceiling !== null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ABC Ceiling</span>
                      <AmountDisplay amount={ceiling.toString()} />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right: APP item selector (multi-select) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">APP Items *</CardTitle>
            </CardHeader>
            <CardContent>
              {!watchOfficeId ? (
                <p className="text-sm text-muted-foreground">Select an office to load APP items.</p>
              ) : loadingItems ? (
                <p className="text-sm text-muted-foreground">Loading items…</p>
              ) : appItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No approved APP items found for this office.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto space-y-1 pr-1">
                  {appItems.map(item => {
                    const taken = item.has_active_pr
                    const itemMode = normalizeMode(item.procurement_mode)
                    const modeBlocked = unifiedMode !== null && itemMode !== unifiedMode
                    const isSelected = selectedIds.includes(item.id)
                    const disabled = taken || modeBlocked
                    const reason = taken
                      ? "An active Purchase Request already exists for this APP item"
                      : modeBlocked
                        ? `Different mode (${MODE_LABELS[itemMode] ?? itemMode}) — start a separate PR`
                        : undefined

                    const lotItems = item.source_ppmp_lot?.ppmp_lot_items ?? []

                    return (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => toggleItem(item)}
                        disabled={disabled}
                        title={reason}
                        className={cn(
                          "w-full text-left rounded-md border p-3 text-sm transition-colors",
                          disabled
                            ? "border-border bg-muted/40 opacity-60 cursor-not-allowed"
                            : isSelected
                              ? "border-blue-500 bg-blue-50"
                              : "border-border hover:bg-muted"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <div
                              className={cn(
                                "mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center",
                                isSelected ? "bg-blue-600 border-blue-600 text-white" : "border-border"
                              )}
                            >
                              {isSelected && <Check className="h-3 w-3" />}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{item.general_description}</p>
                              <p className="text-xs text-muted-foreground">{item.procurement_mode}</p>
                              {item.ppmp_creator_name && (
                                <p className="text-xs text-muted-foreground/70">PPMP by {item.ppmp_creator_name}</p>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 text-right space-y-1">
                            <AmountDisplay amount={item.estimated_budget} className="text-xs font-semibold" />
                            <div className="flex items-center justify-end gap-1">
                              {item.lot && (
                                <Badge variant="outline" className="text-xs">Lot {item.lot.lot_number}</Badge>
                              )}
                              {taken && (
                                <Badge variant="outline" className="text-xs border-amber-400 text-amber-700">
                                  PR exists
                                </Badge>
                              )}
                              {!taken && modeBlocked && (
                                <Badge variant="outline" className="text-xs border-muted-foreground/40">
                                  <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                  diff mode
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* PPMP lot items */}
                        {lotItems.length > 0 && (
                          <ul className="mt-2 ml-6 space-y-0.5 border-t pt-2">
                            {lotItems.map((li) => (
                              <li key={li.id} className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                                <span className="truncate">
                                  {li.description}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                  {Number(li.quantity).toLocaleString()} {li.unit} &times; {formatPeso(Number(li.estimated_unit_cost))}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Line items */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Line Items *</CardTitle>
          </CardHeader>
          <CardContent>
            {watchItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Select one or more APP items above to populate line items.</p>
            ) : (
              <PrItemsEdit control={form.control} watchItems={watchItems} />
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={form.formState.isSubmitting || ceilingExceeded || watchItems.length === 0}
          >
            {form.formState.isSubmitting ? "Saving…" : "Save as Draft"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>
    </Form>
  )
}
