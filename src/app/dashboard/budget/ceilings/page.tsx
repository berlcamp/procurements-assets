"use client"

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { PlusIcon, GavelIcon } from "lucide-react"
import { useFiscalYear } from "@/lib/hooks/use-fiscal-year"
import { usePermissions } from "@/lib/hooks/use-permissions"
import {
  listBudgetCeilings,
  getFiscalYearPlanningStage,
} from "@/lib/actions/budget"
import {
  CEILING_STAGE_LABELS,
  CEILING_STAGE_ORDER,
  CEILING_STAGE_LEGAL_BASIS,
  CEILING_TIER_LABELS,
  PLANNING_STAGE_LABELS,
} from "@/lib/schemas/budget"
import { CeilingFormDialog } from "@/components/budget/ceiling-form-dialog"
import { AmountDisplay } from "@/components/shared/amount-display"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { BudgetCeiling, PlanningStage } from "@/types/database"

/** Write permission checked by the RLS policy on procurements.budget_ceilings. */
const MANAGE_PERMISSION = "budget.ceilings_manage"

const stageBadgeVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  indicative:   "outline",
  nep:          "outline",
  gaa:          "secondary",
  final:        "default",
  supplemental: "secondary",
}

function formatDate(value: string | null) {
  if (!value) return "—"
  return format(new Date(value), "MMM d, yyyy")
}

export default function BudgetCeilingsPage() {
  const { fiscalYear, allYears, loading: fyLoading } = useFiscalYear()
  const { can, loading: permsLoading } = usePermissions()

  // Explicit user choice only. The active fiscal year is the derived default,
  // so nothing has to be written back into state once the hook resolves.
  const [pickedFyId, setPickedFyId] = useState<string>("")
  const [ceilings, setCeilings] = useState<BudgetCeiling[]>([])
  const [planningStage, setPlanningStage] = useState<PlanningStage | null>(null)
  const [loadedFyId, setLoadedFyId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BudgetCeiling | undefined>(undefined)

  const canManage = can(MANAGE_PERMISSION)
  const selectedFyId = pickedFyId || fiscalYear?.id || ""
  const loading = Boolean(selectedFyId) && loadedFyId !== selectedFyId

  // The effect owns every fetch. `reloadToken` is how a successful save asks
  // for a refetch without a second code path.
  useEffect(() => {
    if (!selectedFyId) return
    let active = true

    void (async () => {
      const [list, stage] = await Promise.all([
        listBudgetCeilings(selectedFyId),
        getFiscalYearPlanningStage(selectedFyId),
      ])
      // A slower response for a fiscal year the user has since switched away
      // from must not overwrite the current one.
      if (!active) return

      if (list.error) toast.error(list.error)
      // The actions' success and failure branches collapse to `data?: T` on
      // the client, so fall back explicitly rather than relying on narrowing.
      setCeilings(list.data ?? [])

      // A missing stage is not worth a toast — the banner just falls back.
      setPlanningStage(stage.error ? null : stage.data ?? null)
      setLoadedFyId(selectedFyId)
    })()

    return () => {
      active = false
    }
  }, [selectedFyId, reloadToken])

  const fiscalYearItems = useMemo(
    () =>
      Object.fromEntries(
        allYears.map((fy) => [
          fy.id,
          `FY ${fy.year}${fy.is_active ? " (Active)" : ""}`,
        ])
      ),
    [allYears]
  )

  // Which stages already have an operative ceiling — drives the chain strip.
  const authoritativeByStage = useMemo(() => {
    const map: Record<string, BudgetCeiling> = {}
    for (const c of ceilings) {
      if (c.is_authoritative) map[c.stage] = c
    }
    return map
  }, [ceilings])

  const selectedYear = allYears.find((fy) => fy.id === selectedFyId)

  function openCreate() {
    setEditing(undefined)
    setDialogOpen(true)
  }

  function openEdit(ceiling: BudgetCeiling) {
    setEditing(ceiling)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Budget Ceilings</h1>
          <p className="text-muted-foreground text-sm">
            The budget authority a procurement plan is prepared against. PPMP and
            APP planning stages are derived from these records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            onValueChange={(v) => {
              if (v) setPickedFyId(v as string)
            }}
            value={selectedFyId}
            items={fiscalYearItems}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select fiscal year" />
            </SelectTrigger>
            <SelectContent
              alignItemWithTrigger={false}
              className="w-auto min-w-[var(--anchor-width)]"
            >
              {allYears.map((fy) => (
                <SelectItem key={fy.id} value={fy.id}>
                  FY {fy.year}
                  {fy.is_active ? " (Active)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage && (
            <Button onClick={openCreate} disabled={!selectedFyId}>
              <PlusIcon className="mr-1.5 h-4 w-4" />
              Record Ceiling
            </Button>
          )}
        </div>
      </div>

      {/* Derived planning stage + the ceiling chain */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
            <GavelIcon className="h-4 w-4" />
            Planning stage in force
            {selectedYear ? ` — FY ${selectedYear.year}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <p className="text-2xl font-bold">
              {planningStage
                ? PLANNING_STAGE_LABELS[planningStage] ?? planningStage
                : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {planningStage
                ? "Stamped on PPMP and APP versions. Derived, never set by an approval action."
                : "No ceiling recorded — planning defaults to Indicative."}
            </p>
          </div>

          {/* Escalating chain. `supplemental` is excluded by design: a
              supplemental release never changes the fiscal year's base stage. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {CEILING_STAGE_ORDER.map((s, i) => {
              const reached = Boolean(authoritativeByStage[s])
              return (
                <div key={s} className="flex items-center gap-1.5">
                  {i > 0 && (
                    <span className="text-muted-foreground/50 text-xs">→</span>
                  )}
                  <span
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-xs",
                      reached
                        ? "border-primary/40 bg-primary/10 font-medium text-foreground"
                        : "border-dashed text-muted-foreground"
                    )}
                    title={CEILING_STAGE_LEGAL_BASIS[s]}
                  >
                    {CEILING_STAGE_LABELS[s]}
                  </span>
                </div>
              )
            })}
            {authoritativeByStage.supplemental && (
              <>
                <span className="text-muted-foreground/50 mx-1 text-xs">+</span>
                <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium">
                  {CEILING_STAGE_LABELS.supplemental}
                </span>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recorded Ceilings ({ceilings.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {fyLoading || permsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !selectedFyId ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <p className="text-muted-foreground text-sm">
                No fiscal year available. Set one up under Administration →
                Fiscal Years first.
              </p>
            </div>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : ceilings.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <p className="text-muted-foreground text-sm">
                No ceilings recorded for this fiscal year. Planning will treat it
                as Indicative until one is entered.
              </p>
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={openCreate}
                >
                  Record the first ceiling
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Legal Basis</TableHead>
                  <TableHead>Issuing Authority</TableHead>
                  <TableHead>Reference #</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Operative</TableHead>
                  {canManage && <TableHead className="w-[60px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ceilings.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant={stageBadgeVariant[c.stage] ?? "outline"}
                          className="w-fit"
                        >
                          {CEILING_STAGE_LABELS[c.stage] ?? c.stage}
                        </Badge>
                        {c.tier && (
                          <span className="text-xs text-muted-foreground">
                            {CEILING_TIER_LABELS[c.tier] ?? c.tier}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {CEILING_STAGE_LEGAL_BASIS[c.stage] ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.issuing_authority}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {c.reference_number ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={c.amount} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(c.issued_date)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(c.effective_date)}
                    </TableCell>
                    <TableCell>
                      {c.is_authoritative ? (
                        <Badge variant="default">Operative</Badge>
                      ) : (
                        <Badge variant="outline">Superseded</Badge>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(c)}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <CeilingFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          fiscalYears={allYears}
          defaultFiscalYearId={selectedFyId}
          ceiling={editing}
          onSaved={() => setReloadToken((t) => t + 1)}
        />
      )}
    </div>
  )
}
