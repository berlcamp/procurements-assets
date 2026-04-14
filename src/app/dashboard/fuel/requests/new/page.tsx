"use client"

import { useEffect, useState } from "react"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { useOffice } from "@/lib/hooks/use-office"
import { Forbidden } from "@/components/shared/forbidden"
import { FuelRequestForm } from "@/components/fuel/fuel-request-form"
import { getFuelTypes } from "@/lib/actions/fuel"
import { Loader2 } from "lucide-react"
import type { FuelType } from "@/types/database"

export default function NewFuelRequestPage() {
  const { can, loading: permsLoading } = usePermissions()
  const { officeId, loading: officeLoading } = useOffice()
  const [fuelTypes, setFuelTypes] = useState<FuelType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const types = await getFuelTypes()
      setFuelTypes(types)
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

  if (!can("fuel.request")) {
    return <Forbidden message="You do not have permission to create fuel requests." />
  }

  if (!officeId) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">You must be assigned to an office to create fuel requests.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New Trip Ticket</h1>
        <p className="text-sm text-muted-foreground">
          Submit a fuel request using the standard government trip ticket form
        </p>
      </div>
      <FuelRequestForm officeId={officeId} fuelTypes={fuelTypes} />
    </div>
  )
}
