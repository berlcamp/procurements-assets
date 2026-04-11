import Link from "next/link"
import { getUsers } from "@/lib/actions/users"
import { getPendingJoinRequests } from "@/lib/actions/join-requests"
import { getUserPermissions } from "@/lib/actions/roles"
import { Button } from "@/components/ui/button"
import { Forbidden } from "@/components/shared/forbidden"
import { UsersTable } from "./users-table"
import { PendingRequestsCard } from "./pending-requests-card"

export default async function UsersPage() {
  const permissions = await getUserPermissions()
  if (!permissions.includes("users.manage")) {
    return (
      <Forbidden
        message="You don't have permission to manage users. Only roles with users.manage (e.g., Division Admin) can access this page."
      />
    )
  }

  const [users, pendingRequests] = await Promise.all([
    getUsers(),
    getPendingJoinRequests(),
  ])

  const canInvite = permissions.includes("users.manage")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted-foreground">
            Manage users in your division.
          </p>
        </div>
        {canInvite && (
          <Link href="/dashboard/admin/users/invite">
            <Button>Invite User</Button>
          </Link>
        )}
      </div>

      <PendingRequestsCard requests={pendingRequests} />

      <UsersTable data={users} />
    </div>
  )
}
