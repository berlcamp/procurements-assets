"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AmountDisplay } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import { Lock, PlusCircle, Trash2 } from "lucide-react"
import type { AppLotWithItems } from "@/types/database"

interface AppLotCardProps {
  lot: AppLotWithItems
  onDelete?: () => void
  onFinalize?: () => void
  onQuickAdd?: () => void
  hasSelectedItems?: boolean
  isPending?: boolean
}

export function AppLotCard({
  lot,
  onDelete,
  onFinalize,
  onQuickAdd,
  hasSelectedItems = false,
  isPending = false,
}: AppLotCardProps) {
  const itemCount = lot.app_items?.length ?? 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="outline" className="font-mono text-xs shrink-0">
              Lot {lot.lot_number}
            </Badge>
            <CardTitle className="text-base truncate">{lot.lot_name}</CardTitle>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <StatusBadge status={lot.status} />
            {onDelete && lot.status === "draft" && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={onDelete}
                disabled={isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {lot.description && (
          <p className="text-sm text-muted-foreground">{lot.description}</p>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {itemCount} item{itemCount !== 1 ? "s" : ""}
            {lot.procurement_method && ` · ${lot.procurement_method.replace(/_/g, " ")}`}
          </span>
          <AmountDisplay amount={lot.total_estimated_cost} className="font-semibold" />
        </div>

        {/* Quick-add and finalize actions, only for draft lots */}
        {lot.status === "draft" && (onQuickAdd || onFinalize) && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
            {onQuickAdd && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={onQuickAdd}
                disabled={!hasSelectedItems || isPending}
                title={hasSelectedItems ? "Add selected items to this lot" : "Select items from the left panel first"}
              >
                <PlusCircle className="h-3 w-3" />
                Add selected
              </Button>
            )}
            {onFinalize && itemCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={onFinalize}
                disabled={isPending}
              >
                <Lock className="h-3 w-3" />
                Finalize lot
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
