"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { userProfileSchema, assignRoleSchema, type UserProfileInput, type AssignRoleInput } from "@/lib/schemas/admin"
import { getUserById, getUserRoles, updateUserProfile, inviteUser, assignRole, revokeRole, deactivateUser } from "@/lib/actions/users"
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
  const [userRoles, setUserRoles] = useState<UserRoleWithRole[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [offices, setOffices] = useState<Office[]>([])
  const [loading, setLoading] = useState(!isInvite)
  const [saving, setSaving] = useState(false)
  const [assigningRole, setAssigningRole] = useState(false)

  const profileForm = useForm<UserProfileInput>({
    resolver: zodResolver(userProfileSchema),
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
      const [profile, roles] = await Promise.all([
        getUserById(params.id),
        getUserRoles(params.id),
      ])
      if (profile) {
        setUser(profile)
        profileForm.reset({
          email: "",
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

  async function onSaveProfile(values: UserProfileInput) {
    if (!divisionId) return
    setSaving(true)

    const result = isInvite
      ? await inviteUser(values, divisionId)
      : await updateUserProfile(params.id, values)

    if (result.error) {
      toast.error(result.error)
      setSaving(false)
      return
    }

    toast.success(isInvite ? "Invite sent." : "Profile updated.")
    router.push("/dashboard/admin/users")
  }

  async function onAssignRole(values: AssignRoleInput) {
    if (!divisionId) return
    setAssigningRole(true)
    const result = await assignRole(values, divisionId)
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
            {isInvite && (
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
              <Label>Office</Label>
              <Select
                value={profileForm.watch("office_id") ?? "none"}
                onValueChange={(v) =>
                  profileForm.setValue("office_id", v === "none" ? undefined : v)
                }
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
                {saving ? "Saving…" : isInvite ? "Send Invite" : "Save Changes"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/dashboard/admin/users")}
              >
                Cancel
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
                  onValueChange={(v) => roleForm.setValue("role_id", v as string)}
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

                <Select
                  onValueChange={(v) =>
                    roleForm.setValue("office_id", v === "none" ? null : v as string)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Office scope (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Division-wide</SelectItem>
                    {offices.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={assigningRole || !roleForm.watch("role_id")}
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
