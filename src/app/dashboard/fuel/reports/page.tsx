"use client"

import { useEffect, useState } from "react"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { Forbidden } from "@/components/shared/forbidden"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Loader2, Search } from "lucide-react"
import { getFuelConsumptionReport, getFuelInventoryList } from "@/lib/actions/fuel"
import { FUEL_STATUS_LABELS } from "@/lib/schemas/fuel"
import type { FuelRequestWithDetails, FuelInventoryWithDetails } from "@/types/database"

function getMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  }
}

export default function FuelReportsPage() {
  const { can, loading: permsLoading } = usePermissions()
  const defaults = getMonthRange()

  const [startDate, setStartDate] = useState(defaults.start)
  const [endDate, setEndDate] = useState(defaults.end)
  const [requests, setRequests] = useState<FuelRequestWithDetails[]>([])
  const [inventory, setInventory] = useState<FuelInventoryWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  async function loadReport() {
    setLoading(true)
    const [reportData, inventoryData] = await Promise.all([
      getFuelConsumptionReport(startDate, endDate),
      getFuelInventoryList(),
    ])
    setRequests(reportData)
    setInventory(inventoryData)
    setLoading(false)
  }

  useEffect(() => {
    if (!permsLoading) loadReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading])

  if (permsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!can("fuel.view_reports")) {
    return <Forbidden message="You don't have permission to view fuel reports." />
  }

  // Summarize consumption by fuel type
  const consumptionByType: Record<string, { name: string; liters: number; count: number }> = {}
  for (const req of requests) {
    const key = req.fuel_type_id
    const name = req.fuel_type?.name ?? "Unknown"
    if (!consumptionByType[key]) {
      consumptionByType[key] = { name, liters: 0, count: 0 }
    }
    consumptionByType[key].liters += parseFloat(req.liters_approved ?? req.liters_requested)
    consumptionByType[key].count += 1
  }

  const totalLitersConsumed = Object.values(consumptionByType).reduce(
    (sum, item) => sum + item.liters,
    0
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Fuel Reports</h1>
        <p className="text-muted-foreground">
          Fuel consumption and stock reports
        </p>
      </div>

      {/* Date Range Filter */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Report Period</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
            <Button onClick={loadReport} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-1" />
              )}
              Generate Report
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total Consumed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {totalLitersConsumed.toLocaleString(undefined, { maximumFractionDigits: 2 })} L
                </div>
                <p className="text-xs text-muted-foreground">In selected period</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Requests Fulfilled</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{requests.length}</div>
                <p className="text-xs text-muted-foreground">Approved/dispensed requests</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Fuel Types Used</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Object.keys(consumptionByType).length}
                </div>
                <p className="text-xs text-muted-foreground">Distinct fuel types</p>
              </CardContent>
            </Card>
          </div>

          {/* Consumption by Fuel Type */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Consumption by Fuel Type</CardTitle>
              <CardDescription>
                Breakdown of fuel usage for {startDate} to {endDate}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {Object.keys(consumptionByType).length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No fuel consumption recorded in this period.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fuel Type</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Liters Consumed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.values(consumptionByType).map(item => (
                      <TableRow key={item.name}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-right">{item.count}</TableCell>
                        <TableCell className="text-right font-medium">
                          {item.liters.toLocaleString(undefined, { maximumFractionDigits: 2 })} L
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Current Stock Levels */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Current Stock Levels</CardTitle>
              <CardDescription>Real-time fuel inventory across all offices</CardDescription>
            </CardHeader>
            <CardContent>
              {inventory.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No fuel inventory records.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fuel Type</TableHead>
                      <TableHead>Office</TableHead>
                      <TableHead className="text-right">Current (L)</TableHead>
                      <TableHead className="text-right">Reorder Point (L)</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventory.map(inv => {
                      const current = parseFloat(inv.current_liters)
                      const reorder = parseFloat(inv.reorder_point)
                      const isLow = reorder > 0 && current <= reorder
                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium">{inv.fuel_type?.name ?? "—"}</TableCell>
                          <TableCell>{inv.office?.name ?? "—"}</TableCell>
                          <TableCell className="text-right font-medium">
                            {current.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {reorder.toLocaleString()}
                          </TableCell>
                          <TableCell>
                            {isLow ? (
                              <Badge variant="destructive">Low</Badge>
                            ) : (
                              <Badge variant="default">OK</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Detailed Request List */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Request Details</CardTitle>
              <CardDescription>Individual fuel requests in the period</CardDescription>
            </CardHeader>
            <CardContent>
              {requests.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No requests in this period.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request #</TableHead>
                      <TableHead>Fuel Type</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead className="text-right">Liters</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Approved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map(req => (
                      <TableRow key={req.id}>
                        <TableCell className="font-medium">{req.request_number}</TableCell>
                        <TableCell>{req.fuel_type?.name ?? "—"}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{req.destination}</TableCell>
                        <TableCell>{req.vehicle_plate_number}</TableCell>
                        <TableCell className="text-right">
                          {parseFloat(req.liters_approved ?? req.liters_requested).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="default">
                            {FUEL_STATUS_LABELS[req.status] ?? req.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {req.approved_at
                            ? new Date(req.approved_at).toLocaleDateString()
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
