import { notFound } from "next/navigation"
import { getDivisionById } from "@/lib/actions/divisions"
import { createAdminClient } from "@/lib/supabase/admin"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import type { UserProfile } from "@/types/database"
import { DivisionUsersTable } from "./division-users-table"

async function getDivisionUsers(divisionId: string): Promise<UserProfile[]> {
  const adminClient = createAdminClient()
  const { data, error } = await adminClient
    .schema("procurements")
    .from("user_profiles")
    .select("*")
    .eq("division_id", divisionId)
    .is("deleted_at", null)
    .order("last_name")

  if (error) return []
  return (data ?? []) as UserProfile[]
}

export default async function DivisionUsersPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const division = await getDivisionById(id)

  if (!division) notFound()

  const users = await getDivisionUsers(id)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Users — {division.name}</h1>
          <p className="text-muted-foreground">
            All user profiles registered in this division.
          </p>
        </div>
        <Link href={`/platform/divisions/${id}`}>
          <Button variant="outline">Back to Division</Button>
        </Link>
      </div>

      <DivisionUsersTable data={users} />
    </div>
  )
}
