"use server"

import { createClient } from "@/lib/supabase/server"
import type { PlatformAuditLog } from "@/types/database"

export interface PlatformAuditLogWithDivision extends PlatformAuditLog {
  division_name?: string | null
}

interface GetPlatformAuditLogsOptions {
  divisionId?: string
  limit?: number
}

export async function getPlatformAuditLogs(
  options?: GetPlatformAuditLogsOptions
): Promise<PlatformAuditLogWithDivision[]> {
  const supabase = await createClient()
  const limit = options?.limit ?? 100

  let query = supabase
    .schema("platform")
    .from("platform_audit_logs")
    .select(
      `
      *,
      divisions:target_division_id (
        name
      )
    `
    )
    .order("created_at", { ascending: false })
    .limit(limit)

  if (options?.divisionId) {
    query = query.eq("target_division_id", options.divisionId)
  }

  const { data, error } = await query

  if (error) {
    console.error("getPlatformAuditLogs error:", error)
    return []
  }

  return (data ?? []).map((row) => {
    const { divisions, ...rest } = row as typeof row & {
      divisions: { name: string } | null
    }
    return {
      ...rest,
      division_name: divisions?.name ?? null,
    } as PlatformAuditLogWithDivision
  })
}
