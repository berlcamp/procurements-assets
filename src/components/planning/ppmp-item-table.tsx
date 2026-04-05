"use client"

import { useState } from "react"
import { toast } from "sonner"
import { deletePpmpProject, deletePpmpLot, deletePpmpLotItem } from "@/lib/actions/ppmp"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { AmountDisplay } from "@/components/shared/amount-display"
import {
  Trash2Icon, PlusIcon, ChevronDownIcon, ChevronRightIcon, PackageIcon,
} from "lucide-react"
import { PPMP_PROJECT_TYPE_LABELS, PROCUREMENT_MODES } from "@/lib/schemas/ppmp"
import type { PpmpProjectWithLots, PpmpLotWithItems, PpmpLotItem } from "@/types/database"

interface PpmpProjectTableProps {
  projects: PpmpProjectWithLots[]
  editable?: boolean
  onAddProject?: () => void
  onAddLot?: (projectId: string) => void
  onAddItem?: (lotId: string) => void
  onChanged?: () => void
}

function getModeLabel(value: string): string {
  return PROCUREMENT_MODES.find((m) => m.value === value)?.label ?? value
}

export function PpmpProjectTable({
  projects,
  editable = false,
  onAddProject,
  onAddLot,
  onAddItem,
  onChanged,
}: PpmpProjectTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<string | null>(null)
  const [openProjects, setOpenProjects] = useState<Set<string>>(
    new Set(projects.map((p) => p.id))
  )

  function toggleProject(id: string) {
    setOpenProjects((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDeleteProject(id: string) {
    setDeletingId(id)
    const result = await deletePpmpProject(id)
    setDeletingId(null)
    if (result.error) { toast.error(result.error); return }
    toast.success("Project removed.")
    setConfirmDeleteProjectId(null)
    onChanged?.()
  }

  async function handleDeleteLot(id: string) {
    setDeletingId(id)
    const result = await deletePpmpLot(id)
    setDeletingId(null)
    if (result.error) { toast.error(result.error); return }
    toast.success("Lot removed.")
    onChanged?.()
  }

  async function handleDeleteItem(id: string) {
    setDeletingId(id)
    const result = await deletePpmpLotItem(id)
    setDeletingId(null)
    if (result.error) { toast.error(result.error); return }
    toast.success("Item removed.")
    onChanged?.()
  }

  const projectPendingDelete = confirmDeleteProjectId
    ? projects.find((p) => p.id === confirmDeleteProjectId)
    : undefined

  const projectDeleteDescPreview = projectPendingDelete?.general_description
    ? projectPendingDelete.general_description.length > 160
      ? `${projectPendingDelete.general_description.slice(0, 160)}…`
      : projectPendingDelete.general_description
    : null

  const totalBudget = projects.reduce((sum, p) => {
    const lots = (p.ppmp_lots ?? []) as PpmpLotWithItems[]
    return sum + lots.reduce((lotSum, l) => {
      const items = l.ppmp_lot_items ?? []
      return lotSum + items.reduce((itemSum, item) =>
        itemSum + parseFloat(item.estimated_total_cost || "0"), 0)
    }, 0)
  }, 0)

  return (
    <div className="space-y-4">
      {projects.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <PackageIcon className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-base text-muted-foreground">
            No procurement projects yet. Add your first project below.
          </p>
        </div>
      )}

      {projects.map((project) => {
        const lots = (project.ppmp_lots ?? []) as PpmpLotWithItems[]
        const isOpen = openProjects.has(project.id)
        const projectBudget = lots.reduce((lotSum, l) => {
          const items = (l as PpmpLotWithItems).ppmp_lot_items ?? []
          return lotSum + items.reduce((itemSum, item) =>
            itemSum + parseFloat(item.estimated_total_cost || "0"), 0)
        }, 0)

        return (
          <Collapsible key={project.id} open={isOpen} onOpenChange={() => toggleProject(project.id)}>
            <div className="rounded-lg border bg-card overflow-hidden">
              {/* Project header */}
              <div className="flex items-start justify-between gap-3 px-4 py-3 bg-muted/30">
                <CollapsibleTrigger className="flex items-start gap-2 text-left flex-1 min-w-0 cursor-pointer">
                  {isOpen
                    ? <ChevronDownIcon className="h-4 w-4 mt-0.5 shrink-0" />
                    : <ChevronRightIcon className="h-4 w-4 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm text-muted-foreground">#{project.project_number}</span>
                      <Badge variant="outline" className="text-sm">
                        {PPMP_PROJECT_TYPE_LABELS[project.project_type] ?? project.project_type}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {lots.length} lot{lots.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <p className="text-base font-medium mt-0.5 line-clamp-2">{project.general_description}</p>
                  </div>
                </CollapsibleTrigger>
                <div className="flex items-center gap-2 shrink-0">
                  <AmountDisplay amount={projectBudget} className="text-sm font-semibold" />
                  {editable && (
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                      disabled={deletingId === project.id}
                      onClick={() => setConfirmDeleteProjectId(project.id)}
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <CollapsibleContent>
                <div className="divide-y">
                  {lots.map((lot) => {
                    const items = (lot as PpmpLotWithItems).ppmp_lot_items ?? []
                    const lotTotal = items.reduce((sum, item) =>
                      sum + parseFloat(item.estimated_total_cost || "0"), 0)
                    return (
                      <div key={lot.id} className="px-4 py-3">
                        {/* Lot header */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-muted-foreground">
                              Lot {lot.lot_number}
                            </span>
                            {lot.lot_title && (
                              <span className="text-sm text-muted-foreground">- {lot.lot_title}</span>
                            )}
                            <Badge variant="secondary" className="text-sm">
                              {getModeLabel(lot.procurement_mode)}
                            </Badge>
                            {lot.pre_procurement_conference && (
                              <Badge variant="outline" className="text-sm">Pre-Proc Conf</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <AmountDisplay amount={lotTotal} className="text-xs font-medium" />
                            {editable && (
                              <Button
                                variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive"
                                disabled={deletingId === lot.id}
                                onClick={() => handleDeleteLot(lot.id)}
                              >
                                <Trash2Icon className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Lot timeline/funds row */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground mb-2">
                          {lot.procurement_start && <span>Start: {lot.procurement_start}</span>}
                          {lot.procurement_end && <span>End: {lot.procurement_end}</span>}
                          {lot.delivery_period && <span>Delivery: {lot.delivery_period}</span>}
                          {lot.source_of_funds && <span>Funds: {lot.source_of_funds}</span>}
                        </div>

                        {/* Items table */}
                        {items.length > 0 && (
                          <div className="rounded-md border bg-card overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-8 text-sm">#</TableHead>
                                  <TableHead className="text-sm">Description</TableHead>
                                  <TableHead className="text-sm">Spec / Size</TableHead>
                                  <TableHead className="text-sm">Unit</TableHead>
                                  <TableHead className="text-right text-sm">Qty</TableHead>
                                  <TableHead className="text-right text-sm">Unit Cost</TableHead>
                                  <TableHead className="text-right text-sm">Total</TableHead>
                                  {editable && <TableHead className="w-8" />}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {items.map((item: PpmpLotItem) => (
                                  <TableRow key={item.id}>
                                    <TableCell className="font-mono text-sm">{item.item_number}</TableCell>
                                    <TableCell className="text-sm max-w-[180px]">
                                      <p className="truncate">{item.description}</p>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground max-w-[120px]">
                                      <p className="truncate">{item.specification || "—"}</p>
                                    </TableCell>
                                    <TableCell className="text-sm">{item.unit}</TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                      {parseFloat(item.quantity).toLocaleString("en-PH", { maximumFractionDigits: 4 })}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <AmountDisplay amount={item.estimated_unit_cost} className="text-sm" />
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <AmountDisplay amount={item.estimated_total_cost} className="text-sm" />
                                    </TableCell>
                                    {editable && (
                                      <TableCell>
                                        <Button
                                          variant="ghost" size="icon"
                                          className="h-6 w-6 text-destructive hover:text-destructive"
                                          disabled={deletingId === item.id}
                                          onClick={() => handleDeleteItem(item.id)}
                                        >
                                          <Trash2Icon className="h-3 w-3" />
                                        </Button>
                                      </TableCell>
                                    )}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}

                        {editable && onAddItem && (
                          <Button
                            variant="ghost" size="sm" className="mt-2"
                            onClick={() => onAddItem(lot.id)}
                          >
                            <PlusIcon className="mr-1 h-3 w-3" />
                            Add Item to Lot {lot.lot_number}
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>

                {editable && onAddLot && (
                  <div className="px-4 py-2 border-t bg-muted/10">
                    <Button variant="outline" size="sm" onClick={() => onAddLot(project.id)}>
                      <PlusIcon className="mr-1 h-3 w-3" />
                      Add Lot
                    </Button>
                  </div>
                )}
              </CollapsibleContent>
            </div>
          </Collapsible>
        )
      })}

      {/* Total budget */}
      {projects.length > 0 && (
        <div className="flex justify-end">
          <div className="flex items-center gap-3 rounded-lg border bg-card px-5 py-3">
            <span className="text-base font-medium text-muted-foreground">Total Estimated Budget:</span>
            <AmountDisplay amount={totalBudget} className="text-base font-semibold" />
          </div>
        </div>
      )}

      {editable && onAddProject && (
        <Button variant="outline" size="sm" onClick={onAddProject}>
          <PlusIcon className="mr-1.5 h-4 w-4" />
          Add Procurement Project
        </Button>
      )}

      <Dialog
        open={confirmDeleteProjectId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteProjectId(null)
        }}
      >
        <DialogContent className="max-w-[calc(100%-2rem)] gap-0 p-0 sm:max-w-md">
          <DialogHeader className="border-b border-border px-6 py-5 text-left">
            <DialogTitle className="text-lg">Delete procurement project?</DialogTitle>
            <DialogDescription className="text-left">
              This will permanently remove{" "}
              <span className="font-medium text-foreground">
                Project #{projectPendingDelete?.project_number ?? "—"}
              </span>
              {projectDeleteDescPreview && (
                <>
                  {" "}
                  <span className="whitespace-pre-wrap">({projectDeleteDescPreview})</span>
                </>
              )}{" "}
              and all lots and line items under it. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="!mx-0 !mb-0 gap-2 border-t border-border bg-muted/40 px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDeleteProjectId(null)}
              disabled={!!confirmDeleteProjectId && deletingId === confirmDeleteProjectId}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!confirmDeleteProjectId || deletingId === confirmDeleteProjectId}
              onClick={() => {
                if (confirmDeleteProjectId) void handleDeleteProject(confirmDeleteProjectId)
              }}
            >
              {deletingId === confirmDeleteProjectId ? "Deleting…" : "Delete project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
