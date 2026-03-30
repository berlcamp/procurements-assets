import Link from "next/link"
import { getUsers } from "@/lib/actions/users"
import { getPendingJoinRequests } from "@/lib/actions/join-requests"
import { Button } from "@/components/ui/button"
import { UsersTable } from "./users-table"
import { PendingRequestsCard } from "./pending-requests-card"

export default async function UsersPage() {
  const [users, pendingRequests] = await Promise.all([
    getUsers(),
    getPendingJoinRequests(),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted-foreground">
            Manage users in your division.
          </p>
        </div>
        <Link href="/dashboard/admin/users/invite">
          <Button>Invite User</Button>
        </Link>
      </div>

      <PendingRequestsCard requests={pendingRequests} />

      <UsersTable data={users} />
    </div>
  )
}
