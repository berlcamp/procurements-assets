import { notFound } from "next/navigation"
import Link from "next/link"
import {
  getPlatformUserById,
  getPlatformUserEmail,
  getPlatformUserRoles,
  getPlatformDivisionRoles,
  getPlatformOfficesForDivision,
} from "@/lib/actions/platform-users"
import { getDivisionById } from "@/lib/actions/divisions"
import { Button } from "@/components/ui/button"
import { ChevronLeftIcon } from "lucide-react"
import { PlatformUserEditor } from "./platform-user-editor"

export default async function PlatformUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [profile, email, userRoles, roles] = await Promise.all([
    getPlatformUserById(id),
    getPlatformUserEmail(id),
    getPlatformUserRoles(id),
    getPlatformDivisionRoles(),
  ])

  if (!profile) notFound()

  // Offices come from the user's own division — super admin edits users within
  // the user's division context, not cross-division.
  const [division, offices] = await Promise.all([
    getDivisionById(profile.division_id),
    getPlatformOfficesForDivision(profile.division_id),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/platform/users" />}
          >
            <ChevronLeftIcon className="mr-1 h-4 w-4" />
            All Users
          </Button>
        </div>
        {division && (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/platform/divisions/${division.id}/users`} />}
          >
            View {division.name} users
          </Button>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold">
          {profile.first_name} {profile.last_name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {email ?? "—"}
          {division && <> · {division.name}</>}
        </p>
      </div>

      <PlatformUserEditor
        profile={profile}
        email={email}
        userRoles={userRoles}
        roles={roles}
        offices={offices}
        divisionId={profile.division_id}
      />
    </div>
  )
}
