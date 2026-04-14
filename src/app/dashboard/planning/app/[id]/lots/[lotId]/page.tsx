import { notFound } from "next/navigation"
import Link from "next/link"
import { getAppById } from "@/lib/actions/app"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/shared/status-badge"
import { AmountDisplay } from "@/components/shared/amount-display"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { ArrowLeft } from "lucide-react"
import type { AppLot, AppItem } from "@/types/database"

interface Props {
  params: Promise<{ id: string; lotId: string }>
}

export default async function LotDetailPage({ params }: Props) {
  const { id, lotId } = await params
  const app = await getAppById(id)
  if (!app) notFound()

  const supabase = await createClient()

  const { data: lot } = await supabase
    .schema("procurements")
    .from("app_lots")
    .select("*")
    .eq("id", lotId)
    .single()

  if (!lot) notFound()

  const typedLot = lot as AppLot

  const { data: items } = await supabase
    .schema("procurements")
    .from("app_items")
    .select("*")
    .eq("lot_id", lotId)
    .is("deleted_at", null)
    .order("lot_item_number", { ascending: true })

  const typedItems = (items ?? []) as AppItem[]
  const fy = app.fiscal_year as { year: number } | undefined

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">Lot {typedLot.lot_number}</Badge>
            <h1 className="text-2xl font-bold">{typedLot.lot_name}</h1>
            <StatusBadge status={typedLot.status} />
          </div>
          <p className="text-base text-muted-foreground">
            FY {fy?.year ?? "—"}
            {` · ${typedLot.procurement_method.replace(/_/g, " ")}`}
          </p>
        </div>
        <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={`/dashboard/planning/app/${id}/lots`} />}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to Lots
        </Button>
      </div>

      {typedLot.description && (
        <p className="text-sm text-muted-foreground">{typedLot.description}</p>
      )}

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Items in This Lot</h2>
            <p className="text-sm text-muted-foreground">{typedItems.length} item{typedItems.length !== 1 ? "s" : ""}</p>
          </div>
          <AmountDisplay amount={typedLot.total_estimated_cost} className="text-lg font-semibold" />
        </div>
        {typedItems.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">No items assigned to this lot yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Procurement Mode</TableHead>
                <TableHead className="text-right">Est. Budget</TableHead>
                <TableHead>Schedule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {typedItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {item.lot_item_number}
                  </TableCell>
                  <TableCell className="font-medium text-sm">{item.general_description}</TableCell>
                  <TableCell className="text-sm capitalize">
                    {item.project_type?.replace(/_/g, " ") ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.procurement_mode?.replace(/_/g, " ") ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <AmountDisplay amount={item.estimated_budget} className="text-sm" />
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.procurement_start && item.procurement_end
                      ? `${item.procurement_start} – ${item.procurement_end}`
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {typedLot.finalized_at && (
        <p className="text-xs text-muted-foreground">
          Finalized on {new Date(typedLot.finalized_at).toLocaleDateString("en-PH")}
        </p>
      )}
    </div>
  )
}
