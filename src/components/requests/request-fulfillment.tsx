"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
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
import { toast } from "sonner"
import { Package, ShoppingCart, CheckCircle } from "lucide-react"
import {
  fulfillRequestFromStock,
  routeRequestToProcurement,
  completeServiceRequest,
  getStockForCatalogItem,
} from "@/lib/actions/requests"
import { getFiscalYears } from "@/lib/actions/budget"
import type { RequestWithDetails, RequestItemWithDetails, FiscalYear } from "@/types/database"

interface RequestFulfillmentProps {
  request: RequestWithDetails
  onComplete: () => void
}

type StockAvailability = {
  id: string
  office_id: string
  office_name: string
  current_quantity: string
}

type FulfillmentEntry = {
  request_item_id: string
  inventory_id: string
  quantity_to_issue: number
}

export function RequestFulfillment({ request, onComplete }: RequestFulfillmentProps) {
  const [stockMap, setStockMap] = useState<Record<string, StockAvailability[]>>({})
  const [fulfillmentEntries, setFulfillmentEntries] = useState<Record<string, FulfillmentEntry>>({})
  const [submitting, setSubmitting] = useState(false)
  const [routeOpen, setRouteOpen] = useState(false)
  const [serviceOpen, setServiceOpen] = useState(false)
  const [serviceRemarks, setServiceRemarks] = useState("")
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [selectedFiscalYear, setSelectedFiscalYear] = useState("")

  const items = request.request_items ?? []
  const unfulfilledItems = items.filter(
    item => parseFloat(item.quantity_issued) < parseFloat(item.quantity_requested)
  )
  const isServiceRequest = request.request_type === "service"

  const loadStockData = useCallback(async () => {
    const newMap: Record<string, StockAvailability[]> = {}
    for (const item of unfulfilledItems) {
      if (item.item_catalog_id) {
        const stock = await getStockForCatalogItem(item.item_catalog_id)
        newMap[item.id] = stock
      }
    }
    setStockMap(newMap)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isServiceRequest) {
      loadStockData()
    }
  }, [loadStockData, isServiceRequest])

  function updateFulfillmentEntry(
    itemId: string,
    field: "inventory_id" | "quantity_to_issue",
    value: string | number
  ) {
    setFulfillmentEntries(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        request_item_id: itemId,
        [field]: value,
      } as FulfillmentEntry,
    }))
  }

  async function handleFulfillFromStock() {
    const entries = Object.values(fulfillmentEntries).filter(
      e => e.inventory_id && e.quantity_to_issue > 0
    )
    if (entries.length === 0) {
      toast.error("Select at least one item to fulfill with quantity")
      return
    }

    setSubmitting(true)
    const result = await fulfillRequestFromStock({
      request_id: request.id,
      items: entries,
    })
    setSubmitting(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Items fulfilled from stock")
      setFulfillmentEntries({})
      onComplete()
    }
  }

  async function handleRouteClick() {
    const fy = await getFiscalYears()
    setFiscalYears(fy)
    const activeFy = fy.find(f => f.status === "open")
    if (activeFy) setSelectedFiscalYear(activeFy.id)
    setRouteOpen(true)
  }

  async function handleRouteToProcurement() {
    if (!selectedFiscalYear) {
      toast.error("Please select a fiscal year")
      return
    }

    setSubmitting(true)
    const result = await routeRequestToProcurement({
      request_id: request.id,
      fiscal_year_id: selectedFiscalYear,
    })
    setSubmitting(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Request routed to procurement — PR created")
      setRouteOpen(false)
      onComplete()
    }
  }

  async function handleCompleteService() {
    setSubmitting(true)
    const result = await completeServiceRequest({
      request_id: request.id,
      remarks: serviceRemarks || null,
    })
    setSubmitting(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success("Service request marked as completed")
      setServiceOpen(false)
      onComplete()
    }
  }

  function getStockBadge(item: RequestItemWithDetails) {
    const stock = stockMap[item.id] ?? []
    const totalAvailable = stock.reduce((sum, s) => sum + parseFloat(s.current_quantity), 0)
    const remaining = parseFloat(item.quantity_requested) - parseFloat(item.quantity_issued)

    if (totalAvailable >= remaining) {
      return <Badge variant="default" className="bg-green-100 text-green-800">In Stock</Badge>
    }
    if (totalAvailable > 0) {
      return <Badge variant="default" className="bg-yellow-100 text-yellow-800">Partial Stock</Badge>
    }
    return <Badge variant="default" className="bg-red-100 text-red-800">No Stock</Badge>
  }

  // Service request — simple completion
  if (isServiceRequest) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Service Fulfillment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Mark this service request as completed once the service has been rendered.
          </p>
          <Button onClick={() => setServiceOpen(true)}>
            Mark Service Completed
          </Button>

          <Dialog open={serviceOpen} onOpenChange={setServiceOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Complete Service Request</DialogTitle>
                <DialogDescription>
                  Confirm that the service for {request.request_number} has been completed.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Completion Remarks</Label>
                  <Textarea
                    value={serviceRemarks}
                    onChange={(e) => setServiceRemarks(e.target.value)}
                    placeholder="Notes about the service rendered..."
                    rows={3}
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => setServiceOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCompleteService} disabled={submitting}>
                    {submitting ? "Completing..." : "Confirm Completion"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    )
  }

  // Supply/equipment/procurement — stock fulfillment + routing
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Fulfillment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {unfulfilledItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">All items have been fulfilled.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Issue Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unfulfilledItems.map(item => {
                  const remaining = parseFloat(item.quantity_requested) - parseFloat(item.quantity_issued)
                  const stockOptions = stockMap[item.id] ?? []
                  const entry = fulfillmentEntries[item.id]

                  return (
                    <TableRow key={item.id}>
                      <TableCell>{item.item_number}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{item.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.item_catalog?.code ?? "No catalog"} &middot; {item.unit}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{remaining}</TableCell>
                      <TableCell>{getStockBadge(item)}</TableCell>
                      <TableCell>
                        {stockOptions.length > 0 ? (
                          <Select
                            value={entry?.inventory_id ?? ""}
                            onValueChange={(v) => v && updateFulfillmentEntry(item.id, "inventory_id", v)}
                          >
                            <SelectTrigger className="w-[180px]">
                              <SelectValue placeholder="Select source..." />
                            </SelectTrigger>
                            <SelectContent>
                              {stockOptions.map(s => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.office_name} ({parseFloat(s.current_quantity).toLocaleString()})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm text-muted-foreground">No stock</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {stockOptions.length > 0 && (
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max={remaining}
                            className="w-24 ml-auto"
                            value={entry?.quantity_to_issue ?? ""}
                            onChange={(e) => updateFulfillmentEntry(item.id, "quantity_to_issue", parseFloat(e.target.value) || 0)}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={handleRouteClick}
                className="gap-1"
              >
                <ShoppingCart className="h-4 w-4" />
                Route to Procurement
              </Button>
              <Button
                onClick={handleFulfillFromStock}
                disabled={submitting || Object.keys(fulfillmentEntries).length === 0}
                className="gap-1"
              >
                <Package className="h-4 w-4" />
                {submitting ? "Issuing..." : "Fulfill from Stock"}
              </Button>
            </div>
          </>
        )}

        {/* Route to Procurement Dialog */}
        <Dialog open={routeOpen} onOpenChange={setRouteOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Route to Procurement</DialogTitle>
              <DialogDescription>
                Create a Purchase Request for unfulfilled items. {unfulfilledItems.length} item(s) will be included.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Fiscal Year *</Label>
                <Select value={selectedFiscalYear} onValueChange={(v) => setSelectedFiscalYear(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select fiscal year..." />
                  </SelectTrigger>
                  <SelectContent>
                    {fiscalYears
                      .filter(fy => fy.status === "open")
                      .map(fy => (
                        <SelectItem key={fy.id} value={fy.id}>
                          FY {fy.year}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setRouteOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleRouteToProcurement} disabled={submitting || !selectedFiscalYear}>
                  {submitting ? "Creating PR..." : "Create Purchase Request"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
