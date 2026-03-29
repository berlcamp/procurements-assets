import Link from "next/link"
import { getUsers } from "@/lib/actions/users"
import { Button } from "@/components/ui/button"
import { UsersTable } from "./users-table"

export default async function UsersPage() {
  const users = await getUsers()

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

      <UsersTable data={users} />
    </div>
  )
}
