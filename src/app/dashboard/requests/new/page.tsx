"use client"

import { useEffect, useState } from "react"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { useOffice } from "@/lib/hooks/use-office"
import { Forbidden } from "@/components/shared/forbidden"
import { RequestForm } from "@/components/requests/request-form"
import { getItemCatalog } from "@/lib/actions/inventory"
import { Loader2 } from "lucide-react"
import type { ItemCatalogWithDetails } from "@/types/database"

export default function NewRequestPage() {
  const { can, loading: permsLoading } = usePermissions()
  const { officeId, loading: officeLoading } = useOffice()
  const [catalogItems, setCatalogItems] = useState<ItemCatalogWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const items = await getItemCatalog()
      setCatalogItems(items)
      setLoading(false)
    }
    load()
  }, [])

  if (permsLoading || officeLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!can("request.create")) {
    return <Forbidden message="You do not have permission to create requests." />
  }

  if (!officeId) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">You must be assigned to an office to create requests.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Request</h1>
        <p className="text-sm text-muted-foreground">
          Create a supply, equipment, service, or procurement request
        </p>
      </div>
      <RequestForm officeId={officeId} catalogItems={catalogItems} />
    </div>
  )
}
