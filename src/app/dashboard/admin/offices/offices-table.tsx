"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Building2Icon, ChevronRightIcon, EyeIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/shared/data-table"
import type { OfficeWithChildren } from "@/types/database"
import type { Column, FilterDef, RowAction } from "@/components/shared/data-table"

interface FlatOffice {
  id: string
  name: string
  code: string
  office_type: string
  is_active: boolean
  depth: number
}

function flattenTree(
  offices: OfficeWithChildren[],
  depth = 0
): FlatOffice[] {
  return offices.flatMap((office) => [
    {
      id: office.id,
      name: office.name,
      code: office.code,
      office_type: office.office_type,
      is_active: office.is_active,
      depth,
    },
    ...(office.children ? flattenTree(office.children, depth + 1) : []),
  ])
}

const TYPE_LABEL: Record<string, string> = {
  division_office: "Division Office",
  school: "School",
  section: "Section",
}

const columns: Column<FlatOffice>[] = [
  {
    key: "name",
    header: "Name",
    render: (row) => (
      <div
        className="flex items-center gap-2"
        style={{ paddingLeft: `${row.depth * 1.5}rem` }}
      >
        {row.depth > 0 && (
          <ChevronRightIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Building2Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Link
          href={`/dashboard/admin/offices/${row.id}`}
          className="font-medium hover:underline"
        >
          {row.name}
        </Link>
      </div>
    ),
  },
  {
    key: "code",
    header: "Code",
    render: (row) => (
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.code}</code>
    ),
  },
  {
    key: "office_type",
    header: "Type",
    render: (row) => (
      <Badge variant="secondary">{TYPE_LABEL[row.office_type] ?? row.office_type}</Badge>
    ),
  },
  {
    key: "is_active",
    header: "Status",
    render: (row) => (
      <Badge variant={row.is_active ? "default" : "outline"}>
        {row.is_active ? "Active" : "Inactive"}
      </Badge>
    ),
  },
]

const filters: FilterDef<FlatOffice>[] = [
  {
    key: "office_type",
    label: "Type",
    options: [
      { label: "Division Office", value: "division_office" },
      { label: "School", value: "school" },
      { label: "Section", value: "section" },
    ],
  },
  {
    key: "is_active",
    label: "Status",
    options: [
      { label: "Active", value: "true" },
      { label: "Inactive", value: "false" },
    ],
  },
]

export function OfficesTable({ tree }: { tree: OfficeWithChildren[] }) {
  const router = useRouter()
  const data = flattenTree(tree)

  const rowActions: RowAction<FlatOffice>[] = [
    {
      label: "View / Edit",
      icon: <EyeIcon />,
      onClick: (row) => router.push(`/dashboard/admin/offices/${row.id}`),
    },
  ]

  return (
    <DataTable
      columns={columns}
      data={data}
      searchable
      searchPlaceholder="Search by name or code..."
      emptyMessage="No offices yet. Add your first office."
      filters={filters}
      rowActions={rowActions}
    />
  )
}
