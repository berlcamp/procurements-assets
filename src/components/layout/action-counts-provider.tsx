"use client"

import { createContext, useContext, useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { getActionCounts } from "@/lib/actions/action-counts"
import { useAuth } from "@/lib/hooks/use-auth"

interface ActionCounts {
  ppmp: number
  app: number
  pr: number
  procurement: number
  total: number
}

const ActionCountsContext = createContext<ActionCounts>({ ppmp: 0, app: 0, pr: 0, procurement: 0, total: 0 })

export function useActionCounts() {
  return useContext(ActionCountsContext)
}

export function ActionCountsProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<ActionCounts>({ ppmp: 0, app: 0, pr: 0, procurement: 0, total: 0 })
  const { user } = useAuth()

  const refresh = useCallback(() => {
    getActionCounts().then(setCounts)
  }, [])

  useEffect(() => {
    if (!user) return
    refresh()

    const supabase = createClient()
    const channel = supabase
      .channel("action-counts-invalidator")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "procurements",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => refresh()
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, refresh])

  return (
    <ActionCountsContext.Provider value={counts}>
      {children}
    </ActionCountsContext.Provider>
  )
}
