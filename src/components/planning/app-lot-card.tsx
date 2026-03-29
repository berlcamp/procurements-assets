import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AmountDisplay } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import type { AppLotWithItems } from "@/types/database"

interface AppLotCardProps {
  lot: AppLotWithItems
}

export function AppLotCard({ lot }: AppLotCardProps) {
  const itemCount = lot.app_items?.length ?? 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              Lot {lot.lot_number}
            </Badge>
            <CardTitle className="text-base">{lot.lot_name}</CardTitle>
          </div>
          <StatusBadge status={lot.status} />
        </div>
        {lot.description && (
          <p className="text-sm text-muted-foreground">{lot.description}</p>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {itemCount} item{itemCount !== 1 ? "s" : ""}
            {lot.procurement_method && ` · ${lot.procurement_method.replace(/_/g, " ")}`}
          </span>
          <AmountDisplay amount={lot.total_estimated_cost} className="font-semibold" />
        </div>
      </CardContent>
    </Card>
  )
}
