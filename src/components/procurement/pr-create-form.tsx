"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import { PrItemsEdit } from "@/components/procurement/pr-items-table"
import { createPrSchema, type CreatePrInput } from "@/lib/schemas/procurement"
import { createPurchaseRequest, getApprovedAppItemsForOffice, checkSplitContract } from "@/lib/actions/procurement"
import type { FiscalYear, Office, AppItem, AppLot } from "@/types/database"
import { cn } from "@/lib/utils"

type AppItemWithLot = AppItem & { lot?: Pick<AppLot, "id" | "lot_name" | "lot_number"> | null }

interface PrCreateFormProps {
  fiscalYear: FiscalYear
  offices: Office[]
}

export function PrCreateForm({ fiscalYear, offices }: PrCreateFormProps) {
  const router = useRouter()
  const [appItems, setAppItems] = useState<AppItemWithLot[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [selectedItem, setSelectedItem] = useState<AppItemWithLot | null>(null)
  const [splitWarning, setSplitWarning] = useState(false)

  const form = useForm<CreatePrInput>({
    resolver: zodResolver(createPrSchema),
    defaultValues: {
      office_id: offices.length === 1 ? offices[0].id : "",
      fiscal_year_id: fiscalYear.id,
      purpose: "",
      app_item_id: "",
      items: [{ item_number: 1, description: "", unit: "", quantity: "1", estimated_unit_cost: "0" }],
    },
  })

  const watchOfficeId = useWatch({ control: form.control, name: "office_id" })
  const watchItems    = useWatch({ control: form.control, name: "items" })

  // Load APP items when office changes
  useEffect(() => {
    if (!watchOfficeId) { setAppItems([]); return }
    setLoadingItems(true)
    getApprovedAppItemsForOffice(watchOfficeId, fiscalYear.id)
      .then(items => setAppItems(items as AppItemWithLot[]))
      .finally(() => setLoadingItems(false))
  }, [watchOfficeId, fiscalYear.id])

  // Split contract advisory check
  useEffect(() => {
    if (!watchOfficeId || !selectedItem) return
    const total = watchItems.reduce((sum, i) => {
      const q = parseFloat(i.quantity || "0")
      const c = parseFloat(i.estimated_unit_cost || "0")
      return sum + (isNaN(q) || isNaN(c) ? 0 : q * c)
    }, 0)
    if (total <= 0) return
    checkSplitContract(watchOfficeId, selectedItem.project_type ?? "goods", total)
      .then(w => setSplitWarning(w?.warning ?? false))
  }, [watchItems, watchOfficeId, selectedItem])

  function handleSelectItem(item: AppItemWithLot) {
    setSelectedItem(item)
    form.setValue("app_item_id", item.id)
    form.setValue("budget_allocation_id", item.budget_allocation_id ?? undefined)
    // Pre-fill first line item from APP item description
    form.setValue("items.0.description", item.general_description)
    form.setValue("items.0.estimated_unit_cost", item.estimated_budget ?? "0")
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

  const available = selectedItem?.budget_allocation_id
    ? null  // would need a live fetch; shown as N/A
    : null

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {splitWarning && (
          <Alert className="border-yellow-400 bg-yellow-50">
            <AlertDescription className="text-yellow-800">
              <strong>Split Contract Advisory:</strong> Cumulative PRs from this office may approach the SVP threshold. Ensure this does not constitute contract splitting under RA 12009.
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
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
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
            </CardContent>
          </Card>

          {/* Right: APP item selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">APP Item *</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField control={form.control} name="app_item_id" render={() => (
                <FormItem>
                  <FormMessage />
                </FormItem>
              )} />
              {!watchOfficeId ? (
                <p className="text-sm text-muted-foreground">Select an office to load APP items.</p>
              ) : loadingItems ? (
                <p className="text-sm text-muted-foreground">Loading items…</p>
              ) : appItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No approved APP items found for this office.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
                  {appItems.map(item => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      className={cn(
                        "w-full text-left rounded-md border p-3 text-sm transition-colors",
                        selectedItem?.id === item.id
                          ? "border-blue-500 bg-blue-50"
                          : "border-border hover:bg-muted"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{item.general_description}</p>
                          <p className="text-xs text-muted-foreground">{item.procurement_mode}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <AmountDisplay amount={item.estimated_budget} className="text-xs font-semibold" />
                          {item.lot && (
                            <Badge variant="outline" className="ml-1 text-xs">Lot {item.lot.lot_number}</Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
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
            <PrItemsEdit control={form.control} watchItems={watchItems} />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save as Draft"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>
    </Form>
  )
}
