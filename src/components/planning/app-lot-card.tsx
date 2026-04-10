"use client"

import { useState, useRef, useEffect, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { AmountDisplay } from "@/components/shared/amount-display"
import { StatusBadge } from "@/components/shared/status-badge"
import { Lock, PlusCircle, Trash2, Check, X, Pencil } from "lucide-react"
import { PROCUREMENT_MODES } from "@/lib/schemas/ppmp"
import type { AppLotWithItems } from "@/types/database"

interface AppLotCardProps {
  lot: AppLotWithItems
  onDelete?: () => void
  onFinalize?: () => void
  onQuickAdd?: () => void
  onUpdate?: (fields: { lot_name?: string; description?: string; procurement_method?: string }) => Promise<{ error: string | null }>
  hasSelectedItems?: boolean
  isPending?: boolean
}

export function AppLotCard({
  lot,
  onDelete,
  onFinalize,
  onQuickAdd,
  onUpdate,
  hasSelectedItems = false,
  isPending = false,
}: AppLotCardProps) {
  const itemCount = lot.app_items?.length ?? 0
  const canEdit = lot.status === "draft" && !!onUpdate

  // Inline edit state
  const [editingField, setEditingField] = useState<"name" | "description" | "method" | null>(null)
  const [editValue, setEditValue] = useState("")
  const [saving, startSaving] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingField])

  const startEdit = (field: "name" | "description" | "method") => {
    if (!canEdit) return
    setEditingField(field)
    if (field === "name") setEditValue(lot.lot_name)
    else if (field === "description") setEditValue(lot.description ?? "")
    else setEditValue(lot.procurement_method ?? "")
  }

  const cancelEdit = () => {
    setEditingField(null)
    setEditValue("")
  }

  const saveEdit = () => {
    if (!onUpdate || !editingField) return
    const trimmed = editValue.trim()

    if (editingField === "name" && trimmed.length < 3) return
    if (editingField === "name" && trimmed === lot.lot_name) { cancelEdit(); return }
    if (editingField === "description" && trimmed === (lot.description ?? "")) { cancelEdit(); return }
    if (editingField === "method" && trimmed === (lot.procurement_method ?? "")) { cancelEdit(); return }

    const payload = editingField === "name"
      ? { lot_name: trimmed }
      : editingField === "description"
      ? { description: trimmed }
      : { procurement_method: trimmed }

    startSaving(async () => {
      await onUpdate(payload)
      setEditingField(null)
      setEditValue("")
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveEdit()
    else if (e.key === "Escape") cancelEdit()
  }

  const procurementModeLabel = (value: string) =>
    PROCUREMENT_MODES.find(m => m.value === value)?.label ?? value.replace(/_/g, " ")

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Badge variant="outline" className="font-mono text-xs shrink-0">
              Lot {lot.lot_number}
            </Badge>
            {editingField === "name" ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <Input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="h-7 text-sm font-semibold"
                  disabled={saving}
                />
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={saveEdit} disabled={saving || editValue.trim().length < 3}>
                  <Check className="h-3 w-3 text-green-600" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={cancelEdit} disabled={saving}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <CardTitle
                className={`text-base truncate ${canEdit ? "cursor-pointer hover:text-primary transition-colors" : ""}`}
                onClick={() => startEdit("name")}
                title={canEdit ? "Click to edit lot name" : undefined}
              >
                {lot.lot_name}
              </CardTitle>
            )}
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
        {editingField === "description" ? (
          <div className="flex items-center gap-1">
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a description..."
              className="h-7 text-sm"
              disabled={saving}
            />
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={saveEdit} disabled={saving}>
              <Check className="h-3 w-3 text-green-600" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={cancelEdit} disabled={saving}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <p
            className={`text-sm text-muted-foreground ${canEdit ? "cursor-pointer hover:text-foreground transition-colors" : ""}`}
            onClick={() => startEdit("description")}
            title={canEdit ? "Click to edit description" : undefined}
          >
            {lot.description || (canEdit ? "Add description..." : "")}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {itemCount} item{itemCount !== 1 ? "s" : ""}
            {editingField === "method" ? (
              <span className="inline-flex items-center gap-1 ml-1">
                <span> · </span>
                <Select
                  value={editValue || "__none__"}
                  onValueChange={(v) => {
                    const val = v === "__none__" ? "" : v
                    setEditValue(val ?? "")
                    if (onUpdate) {
                      startSaving(async () => {
                        await onUpdate({ procurement_method: val ?? "" })
                        setEditingField(null)
                        setEditValue("")
                      })
                    }
                  }}
                >
                  <SelectTrigger className="h-6 text-xs inline-flex w-auto min-w-[10rem]">
                    <SelectValue placeholder="Select method..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No method</SelectItem>
                    {PROCUREMENT_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>
                        {mode.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0" onClick={cancelEdit}>
                  <X className="h-3 w-3" />
                </Button>
              </span>
            ) : lot.procurement_method ? (
              <span
                className={canEdit ? "cursor-pointer hover:text-foreground transition-colors" : ""}
                onClick={(e) => { e.stopPropagation(); startEdit("method") }}
                title={canEdit ? "Click to change procurement method" : undefined}
              >
                {` · ${procurementModeLabel(lot.procurement_method)}`}
              </span>
            ) : canEdit ? (
              <span
                className="cursor-pointer hover:text-foreground transition-colors ml-1 italic"
                onClick={(e) => { e.stopPropagation(); startEdit("method") }}
                title="Click to set procurement method"
              >
                · set method
              </span>
            ) : null}
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
