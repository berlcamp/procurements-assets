"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import {
  userProfileSchema,
  assignRoleSchema,
  type UserProfileInput,
  type AssignRoleInput,
} from "@/lib/schemas/admin"
import {
  assignPlatformRole,
  deactivatePlatformUser,
  reactivatePlatformUser,
  revokePlatformRole,
  updatePlatformUserProfile,
} from "@/lib/actions/platform-users"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type {
  Office,
  Role,
  UserProfile,
  UserRoleWithRole,
} from "@/types/database"

interface PlatformUserEditorProps {
  profile: UserProfile
  email: string | null
  userRoles: UserRoleWithRole[]
  roles: Role[]
  offices: Office[]
  divisionId: string
}

function officesForRole(roleName: string | undefined, offices: Office[]): Office[] {
  if (roleName === "school_head") return offices.filter((o) => o.office_type === "school")
  if (roleName === "section_chief") return offices.filter((o) => o.office_type !== "school")
  return offices
}

const officeRequired = (roleName: string | undefined) =>
  roleName === "section_chief" || roleName === "school_head"

export function PlatformUserEditor({
  profile,
  email,
  userRoles: initialUserRoles,
  roles,
  offices,
  divisionId,
}: PlatformUserEditorProps) {
  const router = useRouter()
  const [userRoles, setUserRoles] = useState<UserRoleWithRole[]>(initialUserRoles)
  const [saving, setSaving] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [deactivating, setDeactivating] = useState(false)

  const profileForm = useForm<UserProfileInput>({
    resolver: zodResolver(userProfileSchema),
    defaultValues: {
      email: email ?? "",
      first_name: profile.first_name,
      middle_name: profile.middle_name ?? "",
      last_name: profile.last_name,
      suffix: profile.suffix ?? "",
      employee_id: profile.employee_id ?? "",
      position: profile.position ?? "",
      department: profile.department ?? "",
      office_id: profile.office_id ?? undefined,
      contact_number: profile.contact_number ?? "",
    },
  })

  const roleForm = useForm<AssignRoleInput>({
    resolver: zodResolver(assignRoleSchema),
    defaultValues: { user_id: profile.id },
  })

  async function onSaveProfile(values: UserProfileInput) {
    setSaving(true)
    const result = await updatePlatformUserProfile(profile.id, values)
    if (result.error) {
      toast.error(result.error)
      setSaving(false)
      return
    }
    toast.success("Profile updated.")
    setSaving(false)
    router.refresh()
  }

  async function onAssignRole(values: AssignRoleInput) {
    setAssigning(true)
    const result = await assignPlatformRole(values, divisionId)
    if (result.error) {
      toast.error(result.error)
      setAssigning(false)
      return
    }
    toast.success("Role assigned.")
    roleForm.reset({ user_id: profile.id })
    setAssigning(false)
    router.refresh()
  }

  async function handleRevoke(userRoleId: string) {
    const result = await revokePlatformRole(userRoleId)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Role revoked.")
    setUserRoles((prev) => prev.filter((r) => r.id !== userRoleId))
    router.refresh()
  }

  async function handleDeactivate() {
    if (!confirm(`Deactivate ${profile.first_name} ${profile.last_name}?`)) return
    setDeactivating(true)
    const result = await deactivatePlatformUser(profile.id)
    if (result.error) {
      toast.error(result.error)
      setDeactivating(false)
      return
    }
    toast.success("User deactivated.")
    setDeactivating(false)
    router.refresh()
  }

  async function handleReactivate() {
    setDeactivating(true)
    const result = await reactivatePlatformUser(profile.id)
    if (result.error) {
      toast.error(result.error)
      setDeactivating(false)
      return
    }
    toast.success("User reactivated.")
    setDeactivating(false)
    router.refresh()
  }

  const selectedAssignRoleId = roleForm.watch("role_id")
  const selectedAssignRole = roles.find((r) => r.id === selectedAssignRoleId)

  const roleItems = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.id, r.display_name])),
    [roles]
  )

  const officeItems = useMemo(
    () =>
      Object.fromEntries([
        ["none", "— No office —"],
        ...offices.map((o) => [o.id, o.name]),
      ]),
    [offices]
  )

  return (
    <div className="space-y-6">
      {/* Status + deactivate */}
      <Card>
        <CardHeader>
          <CardTitle>Account Status</CardTitle>
          <CardDescription>
            {profile.is_active
              ? "This user can sign in and act within their division."
              : "This user is deactivated and cannot sign in."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          {profile.is_active ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeactivate}
              disabled={deactivating}
            >
              {deactivating ? "Deactivating…" : "Deactivate User"}
            </Button>
          ) : (
            <Button size="sm" onClick={handleReactivate} disabled={deactivating}>
              {deactivating ? "Reactivating…" : "Reactivate User"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Profile form */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Update user details.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={profileForm.handleSubmit(onSaveProfile)}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={email ?? ""} disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input {...profileForm.register("first_name")} />
                {profileForm.formState.errors.first_name && (
                  <p className="text-xs text-destructive">
                    {profileForm.formState.errors.first_name.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Middle</Label>
                <Input {...profileForm.register("middle_name")} />
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input {...profileForm.register("last_name")} />
                {profileForm.formState.errors.last_name && (
                  <p className="text-xs text-destructive">
                    {profileForm.formState.errors.last_name.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input {...profileForm.register("employee_id")} />
              </div>
              <div className="space-y-2">
                <Label>Position</Label>
                <Input {...profileForm.register("position")} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Office</Label>
              <Select
                value={profileForm.watch("office_id") ?? "none"}
                onValueChange={(v) =>
                  profileForm.setValue("office_id", v === "none" ? undefined : (v as string))
                }
                items={officeItems}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select office" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No office —</SelectItem>
                  {offices.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Role assignment */}
      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
          <CardDescription>
            Assign or revoke roles within this user&apos;s division.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {userRoles.length > 0 ? (
            <div className="space-y-2">
              {userRoles.map((ur) => (
                <div
                  key={ur.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div>
                    <span className="font-medium text-sm">{ur.role.display_name}</span>
                    {ur.office && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        @ {ur.office.name}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleRevoke(ur.id)}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No roles assigned.</p>
          )}

          <Separator />

          <form onSubmit={roleForm.handleSubmit(onAssignRole)} className="space-y-3">
            <p className="text-sm font-medium">Assign new role</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                onValueChange={(v) => {
                  roleForm.setValue("role_id", v as string)
                  roleForm.setValue("office_id", null)
                }}
                items={roleItems}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="space-y-1">
                <Select
                  onValueChange={(v) =>
                    roleForm.setValue(
                      "office_id",
                      v === "none" ? null : (v as string)
                    )
                  }
                  items={Object.fromEntries([
                    ...(!officeRequired(selectedAssignRole?.name)
                      ? [["none", "Division-wide"]]
                      : []),
                    ...officesForRole(selectedAssignRole?.name, offices).map((o) => [
                      o.id,
                      o.name,
                    ]),
                  ])}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        officeRequired(selectedAssignRole?.name)
                          ? "Select office *"
                          : "Office scope (optional)"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {!officeRequired(selectedAssignRole?.name) && (
                      <SelectItem value="none">Division-wide</SelectItem>
                    )}
                    {officesForRole(selectedAssignRole?.name, offices).map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedAssignRole?.name === "school_head" && (
                  <p className="text-xs text-muted-foreground">
                    Required — showing schools only.
                  </p>
                )}
                {selectedAssignRole?.name === "section_chief" && (
                  <p className="text-xs text-muted-foreground">
                    Required — showing non-school offices only.
                  </p>
                )}
              </div>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={
                assigning ||
                !roleForm.watch("role_id") ||
                (officeRequired(selectedAssignRole?.name) && !roleForm.watch("office_id"))
              }
            >
              {assigning ? "Assigning…" : "Assign Role"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
