"use server"

import { createClient } from "@/lib/supabase/server"
import type { AuditLog } from "@/types/database"

export interface AuditLogFilters {
  table_name?: string
  action?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export async function getAuditLogs(
  filters: AuditLogFilters = {}
): Promise<{ data: AuditLog[]; count: number }> {
  const supabase = await createClient()
  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0

  let query = supabase
    .schema("audit")
    .from("audit_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (filters.table_name) {
    query = query.eq("table_name", filters.table_name)
  }
  if (filters.action) {
    query = query.eq("action", filters.action)
  }
  if (filters.from) {
    query = query.gte("created_at", filters.from)
  }
  if (filters.to) {
    query = query.lte("created_at", filters.to)
  }

  const { data, count, error } = await query

  if (error) return { data: [], count: 0 }
  return { data: (data ?? []) as AuditLog[], count: count ?? 0 }
}
