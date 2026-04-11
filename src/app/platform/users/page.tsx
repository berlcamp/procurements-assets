import { getAllPlatformUsers } from "@/lib/actions/platform-users"
import { getDivisions } from "@/lib/actions/divisions"
import { getRoles } from "@/lib/actions/roles"
import { PlatformUsersTable } from "./platform-users-table"

export default async function PlatformUsersPage() {
  const [users, divisions, roles] = await Promise.all([
    getAllPlatformUsers(),
    getDivisions(),
    getRoles(),
  ])

  const divisionRoles = roles.filter((r) => r.scope !== "platform")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-muted-foreground">
          All users across every division. Click a row to edit profile, assign
          roles, or deactivate.
        </p>
      </div>

      <PlatformUsersTable
        data={users}
        divisions={divisions}
        roles={divisionRoles}
      />
    </div>
  )
}
