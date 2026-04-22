import { z } from "zod"

// ============================================================
// Constants & Labels
// ============================================================

export const ITEM_CATEGORIES = ['consumable', 'semi_expendable', 'ppe'] as const

export const ITEM_CATEGORY_LABELS: Record<string, string> = {
  consumable: 'Consumable',
  semi_expendable: 'Semi-Expendable',
  ppe: 'Property, Plant & Equipment',
}

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  stock_in: 'Stock In',
  stock_out: 'Stock Out',
  adjustment: 'Adjustment',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
  return: 'Return',
}

export const REFERENCE_TYPE_LABELS: Record<string, string> = {
  delivery: 'Delivery',
  manual: 'Manual Entry',
  ris: 'Requisition & Issue Slip',
  physical_count: 'Physical Count',
  transfer: 'Transfer',
}

// ============================================================
// Item Catalog schemas
// ============================================================

export const itemCatalogSchema = z.object({
  code: z.string().min(1, "Item code is required"),
  name: z.string().min(2, "Item name must be at least 2 characters"),
  description: z.string().nullable().optional(),
  category: z.enum(ITEM_CATEGORIES, {
    message: "Category is required",
  }),
  unit: z.string().min(1, "Unit of measure is required"),
  account_code_id: z.string().uuid().nullable().optional(),
  useful_life_years: z.preprocess(
    (v) => (v === null || v === undefined || (typeof v === "number" && isNaN(v)) ? null : v),
    z.number().int().min(0).nullable().optional()
  ),
  is_active: z.boolean(),
})

export type ItemCatalogInput = z.infer<typeof itemCatalogSchema>

// ============================================================
// Inventory schemas
// ============================================================

export const inventorySettingsSchema = z.object({
  reorder_point: z.number()
    .min(0, "Reorder point must be non-negative"),
  location: z.string().nullable().optional(),
})

export type InventorySettingsInput = z.infer<typeof inventorySettingsSchema>

// ============================================================
// Manual Stock In schema
// ============================================================

export const manualStockInSchema = z.object({
  item_catalog_id: z.string().uuid("Item is required"),
  office_id: z.string().uuid("Office is required"),
  quantity: z.number()
    .positive("Quantity must be greater than zero"),
  remarks: z.string().nullable().optional(),
})

export type ManualStockInInput = z.infer<typeof manualStockInSchema>

// ============================================================
// Stock Out schema
// ============================================================

export const stockOutSchema = z.object({
  inventory_id: z.string().uuid(),
  quantity: z.number()
    .positive("Quantity must be greater than zero"),
  reference_type: z.string().min(1, "Reference type is required"),
  reference_id: z.string().uuid().nullable().optional(),
  remarks: z.string().nullable().optional(),
})

export type StockOutInput = z.infer<typeof stockOutSchema>

// ============================================================
// Physical Count schema
// ============================================================

export const physicalCountSchema = z.object({
  inventory_id: z.string().uuid(),
  counted_quantity: z.number()
    .min(0, "Counted quantity cannot be negative"),
  remarks: z.string().nullable().optional(),
})

export type PhysicalCountInput = z.infer<typeof physicalCountSchema>
