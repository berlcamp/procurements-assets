"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { EyeIcon, PlusIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DataTable } from "@/components/shared/data-table"
import type { Column, FilterDef, RowAction } from "@/components/shared/data-table"
import { PlatformInviteForm } from "@/app/platform/users/platform-users-table"
import type { PlatformUserRow } from "@/lib/actions/platform-users"
import type { Role } from "@/types/database"

function fullName(u: PlatformUserRow): string {
  const parts = [u.first_name, u.middle_name, u.last_name].filter(Boolean).join(" ")
  return u.suffix ? `${parts}, ${u.suffix}` : parts
}

interface DivisionUsersTableProps {
  data: PlatformUserRow[]
  divisionId: string
  divisionName: string
  roles: Role[]
}

export function DivisionUsersTable({
  data,
  divisionId,
  divisionName,
  roles,
}: DivisionUsersTableProps) {
  const router = useRouter()
  const [inviteOpen, setInviteOpen] = useState(false)

  const columns: Column<PlatformUserRow>[] = useMemo(
    () => [
      {
        key: "last_name",
        header: "Name",
        render: (row) => (
          <Link
            href={`/platform/users/${row.id}`}
            className="font-medium hover:underline"
          >
            {fullName(row)}
          </Link>
        ),
      },
      {
        key: "email",
        header: "Email",
        render: (row) => (
          <span className="text-sm text-muted-foreground">{row.email ?? "—"}</span>
        ),
      },
      {
        key: "roles",
        header: "Roles",
        render: (row) =>
          row.roles && row.roles.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.roles.map((r) => (
                <Badge key={r.id} variant="secondary" className="text-xs">
                  {r.display_name}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">No roles</span>
          ),
      },
      {
        key: "office_id",
        header: "Office",
        render: (row) => (
          <span className="text-sm">
            {row.office?.name ?? <span className="text-muted-foreground">—</span>}
          </span>
        ),
      },
      {
        key: "employee_id",
        header: "Employee ID",
        render: (row) =>
          row.employee_id ? (
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {row.employee_id}
            </code>
          ) : (
            <span className="text-muted-foreground">—</span>
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
    ],
    []
  )

  const filters: FilterDef<PlatformUserRow>[] = [
    {
      key: "is_active",
      label: "Status",
      options: [
        { label: "Active", value: "true" },
        { label: "Inactive", value: "false" },
      ],
    },
  ]

  const rowActions: RowAction<PlatformUserRow>[] = [
    {
      label: "View / Edit",
      icon: <EyeIcon />,
      onClick: (row) => router.push(`/platform/users/${row.id}`),
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger render={<Button />}>
            <PlusIcon className="mr-1.5 h-4 w-4" />
            Invite User
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Invite user to {divisionName}</DialogTitle>
              <DialogDescription>
                An invite email is sent to the address below. The new user will
                be added to {divisionName}.
              </DialogDescription>
            </DialogHeader>
            <PlatformInviteForm
              roles={roles}
              lockedDivisionId={divisionId}
              onDone={() => {
                setInviteOpen(false)
                router.refresh()
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <DataTable
        columns={columns}
        data={data}
        searchable
        searchPlaceholder="Search by name, email, employee ID, or position…"
        emptyMessage="No users found for this division."
        filters={filters}
        rowActions={rowActions}
      />
    </div>
  )
}
