"use client"

import * as React from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns3Icon,
  MoreHorizontalIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  className?: string
  /** Whether this column appears in the column-toggle menu. Defaults to true. */
  hideable?: boolean
  /** Start hidden in the column-toggle menu. */
  defaultHidden?: boolean
}

export interface FilterDef<T> {
  key: keyof T & string
  label: string
  options: { label: string; value: string }[]
}

export interface RowAction<T> {
  label: string
  icon?: React.ReactNode
  onClick: (row: T) => void
  variant?: "default" | "destructive"
  /** Return true to hide this action for a specific row. */
  hidden?: (row: T) => boolean
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  isLoading?: boolean
  emptyMessage?: string
  onRowClick?: (row: T) => void
  searchable?: boolean
  searchPlaceholder?: string
  filters?: FilterDef<T>[]
  rowActions?: RowAction<T>[]
  columnToggle?: boolean
  pageSize?: number
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export function DataTable<T extends object>({
  columns,
  data,
  isLoading = false,
  emptyMessage = "No data available.",
  onRowClick,
  searchable = false,
  searchPlaceholder = "Search...",
  filters,
  rowActions,
  columnToggle = false,
  pageSize: initialPageSize = 20,
}: DataTableProps<T>) {
  const [search, setSearch] = React.useState("")
  const [activeFilters, setActiveFilters] = React.useState<
    Record<string, string>
  >({})
  const [hiddenColumns, setHiddenColumns] = React.useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key))
  )
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(initialPageSize)

  React.useEffect(() => {
    setPage(1)
  }, [search, activeFilters])

  const filteredData = React.useMemo(() => {
    let result = data

    if (searchable && search.trim()) {
      const lower = search.toLowerCase()
      result = result.filter((row) =>
        columns.some((col) => {
          const val = (row as Record<string, unknown>)[col.key]
          return typeof val === "string" && val.toLowerCase().includes(lower)
        })
      )
    }

    for (const [key, value] of Object.entries(activeFilters)) {
      if (!value || value === "__all__") continue
      result = result.filter((row) => {
        const val = (row as Record<string, unknown>)[key]
        return String(val ?? "") === value
      })
    }

    return result
  }, [data, search, searchable, columns, activeFilters])

  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize))

  const paginatedData = React.useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredData.slice(start, start + pageSize)
  }, [filteredData, page, pageSize])

  const visibleColumns = columns.filter((col) => !hiddenColumns.has(col.key))

  const toggleColumn = (key: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const colSpan = visibleColumns.length + (rowActions ? 1 : 0)
  const hasToolbar = searchable || (filters && filters.length > 0) || columnToggle

  return (
    <div className="space-y-3">
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          )}

          {filters?.map((filter) => (
            <Select
              key={filter.key}
              value={activeFilters[filter.key] ?? "__all__"}
              onValueChange={(val) =>
                setActiveFilters((prev) => ({ ...prev, [filter.key]: val } as Record<string, string>))
              }
              items={Object.fromEntries([
                ["__all__", `All ${filter.label}`],
                ...filter.options.map((opt) => [opt.value, opt.label]),
              ])}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={`All ${filter.label}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All {filter.label}</SelectItem>
                {filter.options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}

          {columnToggle && (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                >
                  <Columns3Icon />
                  Columns
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {columns
                    .filter((col) => col.hideable !== false)
                    .map((col) => (
                      <DropdownMenuCheckboxItem
                        key={col.key}
                        checked={!hiddenColumns.has(col.key)}
                        onCheckedChange={() => toggleColumn(col.key)}
                      >
                        {col.header}
                      </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleColumns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.header}
                </TableHead>
              ))}
              {rowActions && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: colSpan }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, rowIndex) => (
                <TableRow
                  key={rowIndex}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? "cursor-pointer" : undefined}
                >
                  {visibleColumns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.render
                        ? col.render(row)
                        : String(
                            (row as Record<string, unknown>)[col.key] ?? ""
                          )}
                    </TableCell>
                  ))}
                  {rowActions && (
                    <RowActionsCell row={row} actions={rowActions} />
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {filteredData.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => {
                setPageSize(Number(val))
                setPage(1)
              }}
              items={Object.fromEntries(PAGE_SIZE_OPTIONS.map((n) => [String(n), String(n)]))}
            >
              <SelectTrigger className="w-16" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <span>
              {(page - 1) * pageSize + 1}–
              {Math.min(page * pageSize, filteredData.length)} of{" "}
              {filteredData.length}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeftIcon />
                <span className="sr-only">Previous page</span>
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                <ChevronRightIcon />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RowActionsCell<T>({
  row,
  actions,
}: {
  row: T
  actions: RowAction<T>[]
}) {
  const visible = actions.filter((a) => !a.hidden?.(row))

  if (visible.length === 0) {
    return <TableCell className="w-12" />
  }

  return (
    <TableCell className="w-12 py-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" })
          )}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <MoreHorizontalIcon />
          <span className="sr-only">Open menu</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {visible.map((action) => (
            <DropdownMenuItem
              key={action.label}
              variant={action.variant}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                action.onClick(row)
              }}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </TableCell>
  )
}
