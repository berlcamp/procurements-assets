"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { EyeIcon, PlusIcon } from "lucide-react"
import { inviteUserSchema, type InviteUserInput } from "@/lib/schemas/admin"
import {
  getPlatformOfficesForDivision,
  invitePlatformUser,
} from "@/lib/actions/platform-users"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/shared/data-table"
import type { Column, FilterDef, RowAction } from "@/components/shared/data-table"
import type { PlatformUserRow } from "@/lib/actions/platform-users"
import type { Division, Office, Role } from "@/types/database"

function fullName(u: PlatformUserRow): string {
  const parts = [u.first_name, u.middle_name, u.last_name]
    .filter(Boolean)
    .join(" ")
  return u.suffix ? `${parts}, ${u.suffix}` : parts
}

function officesForRole(roleName: string | undefined, offices: Office[]): Office[] {
  if (roleName === "school_head") return offices.filter((o) => o.office_type === "school")
  if (roleName === "section_chief") return offices.filter((o) => o.office_type !== "school")
  return offices
}

const officeRequired = (roleName: string | undefined) =>
  roleName === "section_chief" || roleName === "school_head"

interface PlatformUsersTableProps {
  data: PlatformUserRow[]
  divisions: Division[]
  roles: Role[]
}

export function PlatformUsersTable({ data, divisions, roles }: PlatformUsersTableProps) {
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
          <span className="text-sm text-muted-foreground">
            {row.email ?? "—"}
          </span>
        ),
      },
      {
        key: "division_id",
        header: "Division",
        render: (row) => (
          <span className="text-sm">
            {row.division?.name ?? <span className="text-muted-foreground">—</span>}
          </span>
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

  const filters: FilterDef<PlatformUserRow>[] = useMemo(
    () => [
      {
        key: "division_id",
        label: "Division",
        options: divisions.map((d) => ({ label: d.name, value: d.id })),
      },
      {
        key: "is_active",
        label: "Status",
        options: [
          { label: "Active", value: "true" },
          { label: "Inactive", value: "false" },
        ],
      },
    ],
    [divisions]
  )

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
              <DialogTitle>Invite user to a division</DialogTitle>
              <DialogDescription>
                An invite email is sent to the address below. Pick the division
                first, then the role and office.
              </DialogDescription>
            </DialogHeader>
            <PlatformInviteForm
              divisions={divisions}
              roles={roles}
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
        searchPlaceholder="Search by name, email, or position…"
        emptyMessage="No users found."
        filters={filters}
        rowActions={rowActions}
      />
    </div>
  )
}

interface PlatformInviteFormProps {
  /** Required when the user can pick a division. Ignored when `lockedDivisionId` is set. */
  divisions?: Division[]
  roles: Role[]
  onDone: () => void
  /** If provided, division selector is hidden and this value is used. */
  lockedDivisionId?: string
}

export function PlatformInviteForm({
  divisions = [],
  roles,
  onDone,
  lockedDivisionId,
}: PlatformInviteFormProps) {
  const [divisionId, setDivisionId] = useState<string | "">(lockedDivisionId ?? "")
  const [offices, setOffices] = useState<Office[]>([])
  const [loadingOffices, setLoadingOffices] = useState(false)
  const [saving, setSaving] = useState(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    reset,
  } = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: {
      email: "",
      first_name: "",
      middle_name: "",
      last_name: "",
      suffix: "",
      employee_id: "",
      position: "",
      department: "",
      contact_number: "",
      role_id: "",
      office_id: "",
    },
  })

  async function handleDivisionChange(id: string) {
    setDivisionId(id)
    setValue("office_id", "", { shouldValidate: false })
    setValue("role_id", "", { shouldValidate: false })
    setLoadingOffices(true)
    const data = await getPlatformOfficesForDivision(id)
    setOffices(data)
    setLoadingOffices(false)
  }

  // When the dialog is opened with a locked division, load its offices once.
  useEffect(() => {
    if (!lockedDivisionId) return
    let cancelled = false
    setLoadingOffices(true)
    getPlatformOfficesForDivision(lockedDivisionId).then((data) => {
      if (cancelled) return
      setOffices(data)
      setLoadingOffices(false)
    })
    return () => {
      cancelled = true
    }
  }, [lockedDivisionId])

  const selectedRoleId = watch("role_id")
  const selectedRole = roles.find((r) => r.id === selectedRoleId)
  const officesForSelectedRole = officesForRole(selectedRole?.name, offices)

  async function onSubmit(values: InviteUserInput) {
    if (!divisionId) {
      toast.error("Select a division first.")
      return
    }
    setSaving(true)
    const res = await invitePlatformUser(values, divisionId)
    if (res.error) {
      toast.error(res.error)
      setSaving(false)
      return
    }
    toast.success("Invite sent.")
    reset()
    setSaving(false)
    onDone()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {!lockedDivisionId && (
        <div className="space-y-2">
          <Label>Division *</Label>
          <Select
            value={divisionId || undefined}
            onValueChange={(v) => handleDivisionChange((v as string) ?? "")}
            items={Object.fromEntries(divisions.map((d) => [d.id, d.name]))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select division" />
            </SelectTrigger>
            <SelectContent>
              {divisions.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label>Email *</Label>
        <Input type="email" {...register("email")} placeholder="user@deped.gov.ph" />
        {errors.email && (
          <p className="text-xs text-destructive">{errors.email.message}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>First Name *</Label>
          <Input {...register("first_name")} />
          {errors.first_name && (
            <p className="text-xs text-destructive">{errors.first_name.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label>Middle</Label>
          <Input {...register("middle_name")} />
        </div>
        <div className="space-y-2">
          <Label>Last Name *</Label>
          <Input {...register("last_name")} />
          {errors.last_name && (
            <p className="text-xs text-destructive">{errors.last_name.message}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Employee ID</Label>
          <Input {...register("employee_id")} />
        </div>
        <div className="space-y-2">
          <Label>Position</Label>
          <Input {...register("position")} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Role *</Label>
        <Select
          value={selectedRoleId || undefined}
          onValueChange={(v) => {
            setValue("role_id", (v as string) ?? "", { shouldValidate: true })
            setValue("office_id", "", { shouldValidate: false })
          }}
          items={Object.fromEntries(roles.map((r) => [r.id, r.display_name]))}
          disabled={!divisionId}
        >
          <SelectTrigger>
            <SelectValue placeholder={divisionId ? "Select role" : "Pick a division first"} />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.role_id && (
          <p className="text-xs text-destructive">{errors.role_id.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Office *</Label>
        <Select
          value={watch("office_id") || undefined}
          onValueChange={(v) =>
            setValue("office_id", (v as string) ?? "", { shouldValidate: true })
          }
          items={Object.fromEntries(
            officesForSelectedRole.map((o) => [o.id, o.name])
          )}
          disabled={!divisionId || loadingOffices}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                !divisionId
                  ? "Pick a division first"
                  : loadingOffices
                  ? "Loading offices…"
                  : "Select office"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {officesForSelectedRole.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedRole?.name === "school_head" && (
          <p className="text-xs text-muted-foreground">
            Only schools are shown — School Head is scoped to a specific school.
          </p>
        )}
        {selectedRole?.name === "section_chief" && (
          <p className="text-xs text-muted-foreground">
            Only non-school offices are shown — Section Chief is scoped to a
            specific office.
          </p>
        )}
        {errors.office_id && (
          <p className="text-xs text-destructive">{errors.office_id.message}</p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="submit"
          disabled={
            saving ||
            !divisionId ||
            (officeRequired(selectedRole?.name) && !watch("office_id"))
          }
        >
          {saving ? "Sending…" : "Send Invite"}
        </Button>
      </div>
    </form>
  )
}
