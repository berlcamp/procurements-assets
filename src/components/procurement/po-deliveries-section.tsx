"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
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
import { INSPECTION_STATUS_LABELS } from "@/lib/schemas/procurement"
import type { DeliveryWithItems } from "@/types/database"

interface PoDeliveriesSectionProps {
  deliveries: DeliveryWithItems[]
}

const inspectionVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  passed: "default",
  failed: "destructive",
  partial_acceptance: "secondary",
}

export function PoDeliveriesSection({ deliveries }: PoDeliveriesSectionProps) {
  if (deliveries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No deliveries recorded yet.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deliveries ({deliveries.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Delivery #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Items</TableHead>
              <TableHead>Received By</TableHead>
              <TableHead>Inspection</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map(delivery => (
              <TableRow key={delivery.id}>
                <TableCell>
                  <Link
                    href={`/dashboard/procurement/deliveries/${delivery.id}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {delivery.delivery_number}
                  </Link>
                </TableCell>
                <TableCell>
                  {new Date(delivery.delivery_date).toLocaleDateString("en-PH", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </TableCell>
                <TableCell>{delivery.delivery_items?.length ?? 0} items</TableCell>
                <TableCell>
                  {delivery.received_by_profile ? `${delivery.received_by_profile.first_name} ${delivery.received_by_profile.last_name}` : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={inspectionVariants[delivery.inspection_status] ?? "outline"}>
                    {INSPECTION_STATUS_LABELS[delivery.inspection_status] ?? delivery.inspection_status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
