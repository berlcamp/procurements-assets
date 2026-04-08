"use client"

import { useFieldArray, Control } from "react-hook-form"
import { Input } from "@/components/ui/input"
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AmountDisplay } from "@/components/shared/amount-display"
import type { CreatePrInput } from "@/lib/schemas/procurement"
import type { PrItem } from "@/types/database"

// ============================================================
// View mode (read-only)
// ============================================================

interface PrItemsViewProps {
  items: PrItem[]
}

export function PrItemsView({ items }: PrItemsViewProps) {
  const total = items.reduce(
    (sum, item) => sum + parseFloat(item.estimated_total_cost ?? "0"),
    0
  )

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="w-20">Unit</TableHead>
          <TableHead className="w-24 text-right">Qty</TableHead>
          <TableHead className="w-32 text-right">Unit Cost</TableHead>
          <TableHead className="w-36 text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map(item => (
          <TableRow key={item.id}>
            <TableCell className="text-muted-foreground">{item.item_number}</TableCell>
            <TableCell>
              <div>{item.description}</div>
              {item.remarks && (
                <div className="text-xs text-muted-foreground">{item.remarks}</div>
              )}
            </TableCell>
            <TableCell>{item.unit}</TableCell>
            <TableCell className="text-right">{item.quantity}</TableCell>
            <TableCell className="text-right">
              <AmountDisplay amount={item.estimated_unit_cost} />
            </TableCell>
            <TableCell className="text-right font-medium">
              <AmountDisplay amount={item.estimated_total_cost} />
            </TableCell>
          </TableRow>
        ))}
        {items.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
              No line items
            </TableCell>
          </TableRow>
        )}
      </TableBody>
      {items.length > 0 && (
        <tfoot>
          <tr>
            <td colSpan={5} className="px-4 py-2 text-right font-semibold text-sm">
              Total Estimated Cost
            </td>
            <td className="px-4 py-2 text-right font-bold">
              <AmountDisplay amount={total.toString()} />
            </td>
          </tr>
        </tfoot>
      )}
    </Table>
  )
}

// ============================================================
// Edit mode (react-hook-form)
// ============================================================

interface PrItemsEditProps {
  control: Control<CreatePrInput>
  watchItems?: CreatePrInput["items"]
}

export function PrItemsEdit({ control, watchItems = [] }: PrItemsEditProps) {
  const { fields } = useFieldArray({ control, name: "items" })

  const grandTotal = watchItems.reduce((sum, item) => {
    const qty  = parseFloat(item.quantity || "0")
    const cost = parseFloat(item.estimated_unit_cost || "0")
    return sum + (isNaN(qty) || isNaN(cost) ? 0 : qty * cost)
  }, 0)

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Description *</TableHead>
            <TableHead className="w-24">Unit *</TableHead>
            <TableHead className="w-28">Qty *</TableHead>
            <TableHead className="w-36">Unit Cost *</TableHead>
            <TableHead className="w-36 text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field, index) => {
            const qty  = parseFloat(watchItems[index]?.quantity || "0")
            const cost = parseFloat(watchItems[index]?.estimated_unit_cost || "0")
            const rowTotal = isNaN(qty) || isNaN(cost) ? 0 : qty * cost

            return (
              <TableRow key={field.id}>
                <TableCell className="text-muted-foreground text-sm">{index + 1}</TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={`items.${index}.description`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormControl>
                          <Input {...f} placeholder="Item description" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={`items.${index}.unit`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormControl>
                          <Input {...f} placeholder="pcs, set…" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={`items.${index}.quantity`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormControl>
                          <Input {...f} type="number" min="0" step="0.0001" placeholder="0" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell>
                  <FormField
                    control={control}
                    name={`items.${index}.estimated_unit_cost`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormControl>
                          <Input {...f} type="number" min="0" step="0.01" placeholder="0.00" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TableCell>
                <TableCell className="text-right font-medium text-sm">
                  <AmountDisplay amount={rowTotal.toString()} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        <tfoot>
          <tr>
            <td colSpan={5} className="px-4 py-2 text-right font-semibold text-sm">
              Grand Total
            </td>
            <td className="px-4 py-2 text-right font-bold">
              <AmountDisplay amount={grandTotal.toString()} />
            </td>
          </tr>
        </tfoot>
      </Table>

      <p className="text-xs text-muted-foreground">
        To add or remove items, toggle the APP item selection above.
      </p>
    </div>
  )
}
