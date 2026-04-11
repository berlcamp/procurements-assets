import { notFound } from "next/navigation"
import { getDivisionById } from "@/lib/actions/divisions"
import { getAllPlatformUsers } from "@/lib/actions/platform-users"
import { getRoles } from "@/lib/actions/roles"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { DivisionUsersTable } from "./division-users-table"

export default async function DivisionUsersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const division = await getDivisionById(id)
  if (!division) notFound()

  const [allUsers, roles] = await Promise.all([
    getAllPlatformUsers(),
    getRoles(),
  ])

  // Scope to the division we're viewing. `getAllPlatformUsers` already joined
  // roles, office, division, and email via the admin client so we can reuse
  // the same row shape here without an extra round-trip.
  const users = allUsers.filter((u) => u.division_id === id)
  const divisionRoles = roles.filter((r) => r.scope !== "platform")

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Users — {division.name}</h1>
          <p className="text-muted-foreground">
            All user profiles registered in this division. Invite, edit, assign
            roles, or deactivate from here.
          </p>
        </div>
        <Link href={`/platform/divisions/${id}`}>
          <Button variant="outline">Back to Division</Button>
        </Link>
      </div>

      <DivisionUsersTable
        data={users}
        divisionId={id}
        divisionName={division.name}
        roles={divisionRoles}
      />
    </div>
  )
}
