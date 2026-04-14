"use client"

import { useState, Fragment } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AmountDisplay } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { PROCUREMENT_MODES } from "@/lib/schemas/ppmp"
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react"
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import type { AppItemWithOffice } from "@/types/database"
import { cn } from "@/lib/utils"

interface AppItemsTableProps {
  items: AppItemWithOffice[]
  showLotColumn?: boolean
}

function getProcurementModeLabel(value: string | null): string {
  if (!value) return "—"
  const mode = PROCUREMENT_MODES.find(m => m.value === value)
  return mode?.label ?? value
}

export function AppItemsTable({ items, showLotColumn = true }: AppItemsTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  if (items.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No items yet. Items are auto-populated when PPMPs are approved.
        </p>
      </div>
    )
  }

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[32px]" />
            <TableHead className="w-[50px]">#</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Source Office</TableHead>
            <TableHead>Procurement Mode</TableHead>
            <TableHead className="text-right">Est. Budget</TableHead>
            <TableHead>Schedule</TableHead>
            <TableHead>HOPE Review</TableHead>
            {showLotColumn && <TableHead>Lot</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const office = item.source_office as { name: string; code: string } | null
            const lot = item.lot as { lot_name: string; lot_number: number } | null
            const lotItems = item.source_ppmp_lot?.ppmp_lot_items ?? []
            const isExpanded = expandedIds.has(item.id)
            const itemsTotal = lotItems.reduce((s, li) => s + Number(li.estimated_total_cost), 0)
            const declaredBudget = Number(item.estimated_budget)
            const hasMismatch = lotItems.length > 0 && Math.abs(itemsTotal - declaredBudget) >= 0.01

            return (
              <Fragment key={item.id}>
                <TableRow className={cn(isExpanded && "border-b-0")}>
                  <TableCell className="py-2">
                    {lotItems.length > 0 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground"
                        onClick={() => toggleExpand(item.id)}
                        title={isExpanded ? "Hide line items" : "Show line items"}
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5" />
                          : <ChevronRight className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {item.item_number}
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-sm">{item.general_description}</p>
                        {item.is_cse && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-blue-600">CSE</Badge>
                        )}
                        {item.schedule_quarter && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{item.schedule_quarter}</Badge>
                        )}
                      </div>
                      {item.project_type && (
                        <p className="text-xs text-muted-foreground capitalize">
                          {item.project_type.replace(/_/g, " ")}
                        </p>
                      )}
                      {lotItems.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {lotItems.length} line item{lotItems.length !== 1 ? "s" : ""}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {office?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {getProcurementModeLabel(item.procurement_mode)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {hasMismatch && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-orange-500 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-[220px] text-xs">
                              Declared budget differs from item total.
                              Item total: ₱{itemsTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}.
                              Review the PPMP for accuracy.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      <AmountDisplay amount={item.estimated_budget} className="text-sm" />
                      {item.indicative_budget && Number(item.indicative_budget) !== Number(item.estimated_budget) && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <span className={cn(
                                "text-[10px] font-medium",
                                Number(item.estimated_budget) > Number(item.indicative_budget) ? "text-red-500" : "text-green-600"
                              )}>
                                {Number(item.estimated_budget) > Number(item.indicative_budget) ? "+" : ""}
                                {((Number(item.estimated_budget) - Number(item.indicative_budget)) / Number(item.indicative_budget) * 100).toFixed(1)}%
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">
                              Indicative: ₱{Number(item.indicative_budget).toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.procurement_start && item.procurement_end
                      ? `${item.procurement_start} – ${item.procurement_end}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.hope_review_status} />
                    {item.hope_remarks && (
                      <p className="text-xs text-muted-foreground mt-1 max-w-[200px] truncate" title={item.hope_remarks}>
                        {item.hope_remarks}
                      </p>
                    )}
                  </TableCell>
                  {showLotColumn && (
                    <TableCell>
                      {lot ? (
                        <Badge variant="outline" className="text-xs">
                          Lot {lot.lot_number}: {lot.lot_name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>

                {/* Expanded line items sub-table */}
                {isExpanded && lotItems.length > 0 && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={showLotColumn ? 9 : 8} className="p-0 pb-2">
                      <div className="mx-8 my-1 overflow-hidden rounded-lg border border-border/50">
                        <Table className="[&_td]:px-3 [&_td]:py-1.5 [&_th]:h-8 [&_th]:px-3 [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                          <TableHeader className="border-b border-border/40 bg-muted/40 [&_tr]:hover:bg-transparent">
                            <TableRow className="border-0">
                              <TableHead className="w-8">#</TableHead>
                              <TableHead>Item Description</TableHead>
                              <TableHead>Specification</TableHead>
                              <TableHead className="text-right">Qty</TableHead>
                              <TableHead>Unit</TableHead>
                              <TableHead className="text-right">Unit Cost</TableHead>
                              <TableHead className="text-right">Total Cost</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody className="[&_tr]:border-border/30 [&_tr:last-child]:border-0">
                            {lotItems.map((li) => (
                              <TableRow key={li.id} className="bg-white dark:bg-card hover:bg-muted/20">
                                <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">
                                  {li.item_number}
                                </TableCell>
                                <TableCell className="text-sm whitespace-normal max-w-[16rem]">
                                  {li.description}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground whitespace-normal max-w-[12rem]">
                                  {li.specification ?? "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm">
                                  {Number(li.quantity).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-sm">{li.unit}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  <AmountDisplay amount={li.estimated_unit_cost} className="text-sm" />
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  <AmountDisplay amount={li.estimated_total_cost} className="text-sm font-medium" />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
