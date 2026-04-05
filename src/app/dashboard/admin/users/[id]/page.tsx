"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  userProfileSchema,
  inviteUserSchema,
  assignRoleSchema,
  type UserProfileInput,
  type InviteUserInput,
  type AssignRoleInput,
} from "@/lib/schemas/admin"
import { getUserById, getUserEmail, getUserRoles, updateUserProfile, inviteUser, assignRole, revokeRole, deactivateUser } from "@/lib/actions/users"
import { getDivisionRoles } from "@/lib/actions/roles"
import { getOffices } from "@/lib/actions/offices"
import { useDivision } from "@/lib/hooks/use-division"
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
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import type { UserProfile, UserRoleWithRole, Role, Office } from "@/types/database"

export default function UserDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { divisionId } = useDivision()
  const isInvite = params.id === "invite"

  const [user, setUser] = useState<UserProfile | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userRoles, setUserRoles] = useState<UserRoleWithRole[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [offices, setOffices] = useState<Office[]>([])
  const [loading, setLoading] = useState(!isInvite)
  const [saving, setSaving] = useState(false)
  const [assigningRole, setAssigningRole] = useState(false)

  const profileForm = useForm<UserProfileInput & { role_id?: string }>({
    resolver: zodResolver(isInvite ? inviteUserSchema : userProfileSchema),
    defaultValues: {
      email: "",
      first_name: "",
      middle_name: "",
      last_name: "",
      suffix: "",
      employee_id: "",
      position: "",
      department: "",
      office_id: undefined,
      contact_number: "",
      role_id: "",
    },
  })

  const roleForm = useForm<AssignRoleInput>({
    resolver: zodResolver(assignRoleSchema),
    defaultValues: { user_id: params.id },
  })

  const loadData = useCallback(async () => {
    const [allRoles, allOffices] = await Promise.all([
      getDivisionRoles(),
      getOffices(),
    ])
    setRoles(allRoles)
    setOffices(allOffices)

    if (!isInvite) {
      const [profile, roles, email] = await Promise.all([
        getUserById(params.id),
        getUserRoles(params.id),
        getUserEmail(params.id),
      ])
      setUserEmail(email)
      if (profile) {
        setUser(profile)
        profileForm.reset({
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
        })
      }
      setUserRoles(roles)
      roleForm.setValue("user_id", params.id)
    }
    setLoading(false)
  }, [isInvite, params.id, profileForm, roleForm])

  useEffect(() => {
    loadData()
  }, [loadData])

  function effectiveDivisionId(): string | null {
    return divisionId ?? user?.division_id ?? null
  }

  async function onSaveProfile(values: UserProfileInput & { role_id?: string }) {
    const divId = effectiveDivisionId()
    if (isInvite && !divId) {
      toast.error("Division context is not available. Refresh the page or try again.")
      return
    }
    setSaving(true)

    const result = isInvite
      ? await inviteUser(values as InviteUserInput, divId!)
      : await updateUserProfile(params.id, values as UserProfileInput)

    if (result.error) {
      toast.error(result.error)
      setSaving(false)
      return
    }

    toast.success(isInvite ? "Invite sent." : "Profile updated.")
    router.push("/dashboard/admin/users")
  }

  async function onAssignRole(values: AssignRoleInput) {
    const divId = effectiveDivisionId()
    if (!divId) {
      toast.error("Division context is not available. Refresh the page or try again.")
      return
    }
    setAssigningRole(true)
    const result = await assignRole(values, divId)
    if (result.error) {
      toast.error(result.error)
      setAssigningRole(false)
      return
    }
    toast.success("Role assigned.")
    const refreshed = await getUserRoles(params.id)
    setUserRoles(refreshed)
    roleForm.reset({ user_id: params.id })
    setAssigningRole(false)
  }

  async function handleRevokeRole(userRoleId: string) {
    const result = await revokeRole(userRoleId)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Role revoked.")
    setUserRoles((prev) => prev.filter((r) => r.id !== userRoleId))
  }

  // Track selected role name for office filtering
  const selectedInviteRoleId = profileForm.watch("role_id")
  const selectedInviteRole = roles.find((r) => r.id === selectedInviteRoleId)
  const selectedAssignRoleId = roleForm.watch("role_id")
  const selectedAssignRole = roles.find((r) => r.id === selectedAssignRoleId)

  function officesForRole(roleName: string | undefined) {
    if (roleName === "school_head") return offices.filter((o) => o.office_type === "school")
    if (roleName === "section_chief") return offices.filter((o) => o.office_type !== "school")
    return offices
  }

  const officeRequired = (roleName: string | undefined) =>
    roleName === "section_chief" || roleName === "school_head"

  const roleItems = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.id, r.display_name])),
    [roles],
  )
  const officeItems = useMemo(
    () => Object.fromEntries([
      ["none", "— No office —"],
      ...offices.map((o) => [o.id, o.name]),
    ]),
    [offices],
  )
  const officeItemsNoNone = useMemo(
    () => Object.fromEntries(offices.map((o) => [o.id, o.name])),
    [offices],
  )


  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {isInvite ? "Invite User" : "Edit User"}
        </h1>
        {!isInvite && user && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/dashboard/admin/users")}
            >
              Close
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (!confirm("Deactivate this user?")) return
                await deactivateUser(params.id)
                toast.success("User deactivated.")
                router.push("/dashboard/admin/users")
              }}
            >
              Deactivate
            </Button>
          </div>
        )}
      </div>

      {/* Profile form */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            {isInvite
              ? "An invite email will be sent to the provided address."
              : "Update user details."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={profileForm.handleSubmit(onSaveProfile)}
            className="space-y-4"
          >
            {isInvite ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email address *</Label>
                  <Input
                    id="email"
                    type="email"
                    {...profileForm.register("email")}
                    placeholder="user@deped.gov.ph"
                  />
                  {profileForm.formState.errors.email && (
                    <p className="text-xs text-destructive">
                      {profileForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invite-role">Role *</Label>
                  <Select
                    value={profileForm.watch("role_id") || undefined}
                    onValueChange={(v) =>
                      profileForm.setValue("role_id", v ?? "", { shouldValidate: true })
                    }
                    items={roleItems}
                  >
                    <SelectTrigger id="invite-role">
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
                  {profileForm.formState.errors.role_id && (
                    <p className="text-xs text-destructive">
                      {profileForm.formState.errors.role_id.message}
                    </p>
                  )}
                </div>
              </>
            ) : userEmail && (
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={userEmail}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input {...profileForm.register("first_name")} />
              </div>
              <div className="space-y-2">
                <Label>Middle Name</Label>
                <Input {...profileForm.register("middle_name")} />
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input {...profileForm.register("last_name")} />
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
              <Label>{isInvite ? "Office *" : "Office"}</Label>
              {isInvite ? (
                <>
                  <Select
                    value={profileForm.watch("office_id") ?? undefined}
                    onValueChange={(v) =>
                      profileForm.setValue("office_id", v ?? "", { shouldValidate: true })
                    }
                    items={Object.fromEntries(officesForRole(selectedInviteRole?.name).map((o) => [o.id, o.name]))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select office" />
                    </SelectTrigger>
                    <SelectContent>
                      {officesForRole(selectedInviteRole?.name).map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedInviteRole?.name === "school_head" && (
                    <p className="text-xs text-muted-foreground">Only schools are shown — School Head is scoped to a specific school.</p>
                  )}
                  {selectedInviteRole?.name === "section_chief" && (
                    <p className="text-xs text-muted-foreground">Only non-school offices are shown — Section Chief is scoped to a specific office.</p>
                  )}
                </>
              ) : (
                <Select
                  value={profileForm.watch("office_id") ?? "none"}
                  onValueChange={(v) =>
                    profileForm.setValue("office_id", v === "none" ? undefined : v)
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
              )}
              {profileForm.formState.errors.office_id && (
                <p className="text-xs text-destructive">
                  {profileForm.formState.errors.office_id.message}
                </p>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : isInvite ? "Send Invite" : "Save Changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Role assignment (only for existing users) */}
      {!isInvite && (
        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
            <CardDescription>
              Assign or revoke roles for this user.
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
                      <span className="font-medium text-sm">
                        {ur.role.display_name}
                      </span>
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
                      onClick={() => handleRevokeRole(ur.id)}
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

            <form
              onSubmit={roleForm.handleSubmit(onAssignRole)}
              className="space-y-3"
            >
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
                      roleForm.setValue("office_id", v === "none" ? null : v as string)
                    }
                    items={Object.fromEntries([
                      ...(!officeRequired(selectedAssignRole?.name) ? [["none", "Division-wide"]] : []),
                      ...officesForRole(selectedAssignRole?.name).map((o) => [o.id, o.name]),
                    ])}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={officeRequired(selectedAssignRole?.name) ? "Select office *" : "Office scope (optional)"} />
                    </SelectTrigger>
                    <SelectContent>
                      {!officeRequired(selectedAssignRole?.name) && (
                        <SelectItem value="none">Division-wide</SelectItem>
                      )}
                      {officesForRole(selectedAssignRole?.name).map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedAssignRole?.name === "school_head" && (
                    <p className="text-xs text-muted-foreground">Required — showing schools only.</p>
                  )}
                  {selectedAssignRole?.name === "section_chief" && (
                    <p className="text-xs text-muted-foreground">Required — showing non-school offices only.</p>
                  )}
                </div>
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={
                  assigningRole ||
                  !roleForm.watch("role_id") ||
                  (officeRequired(selectedAssignRole?.name) && !roleForm.watch("office_id"))
                }
              >
                {assigningRole ? "Assigning…" : "Assign Role"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
