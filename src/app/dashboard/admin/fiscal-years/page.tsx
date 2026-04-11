"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useDivision } from "@/lib/hooks/use-division"
import { usePermissions } from "@/lib/hooks/use-permissions"
import { Forbidden } from "@/components/shared/forbidden"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"

interface FiscalYear {
  id: string
  division_id: string
  year: number
  is_active: boolean
  start_date: string | null
  end_date: string | null
  status: string
  created_at: string
}

export default function FiscalYearsPage() {
  const { divisionId, loading: divisionLoading } = useDivision()
  const { can, loading: permsLoading } = usePermissions()
  const [years, setYears] = useState<FiscalYear[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [year, setYear] = useState(new Date().getFullYear())

  async function loadYears() {
    const supabase = createClient()
    const { data } = await supabase
      .schema("procurements")
      .from("fiscal_years")
      .select("*")
      .order("year", { ascending: false })
    setYears((data ?? []) as FiscalYear[])
    setLoading(false)
  }

  useEffect(() => {
    loadYears()
  }, [])

  async function handleCreate() {
    if (!divisionId) {
      toast.error("No division assigned. Please contact your administrator.")
      return
    }
    setCreating(true)
    const supabase = createClient()
    const { error } = await supabase.schema("procurements").from("fiscal_years").insert({
      division_id: divisionId,
      year,
      is_active: false,
      status: "planning",
    })
    if (error) {
      toast.error(error.message)
      setCreating(false)
      return
    }
    toast.success(`Fiscal year ${year} created.`)
    await loadYears()
    setCreating(false)
  }

  async function handleSetActive(id: string) {
    const supabase = createClient()
    // Deactivate all first
    await supabase
      .schema("procurements")
      .from("fiscal_years")
      .update({ is_active: false })
      .eq("division_id", divisionId ?? "")
    // Activate selected
    const { error } = await supabase
      .schema("procurements")
      .from("fiscal_years")
      .update({ is_active: true, status: "open" })
      .eq("id", id)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success("Fiscal year activated.")
    await loadYears()
  }

  const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
    open: "default",
    planning: "secondary",
    closing: "secondary",
    closed: "outline",
  }

  if (permsLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (!can("division.settings")) {
    return (
      <Forbidden
        message="You don't have permission to manage fiscal years. Only roles with division.settings (e.g., Division Admin) can access this page."
      />
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Fiscal Years</h1>
        <p className="text-muted-foreground">
          Manage fiscal years for budget and planning cycles.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Fiscal Year</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="space-y-2">
              <Label>Year</Label>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                className="w-32"
                min={2020}
                max={2100}
              />
            </div>
            <Button onClick={handleCreate} disabled={creating || divisionLoading}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Fiscal Years</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : years.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fiscal years yet.</p>
          ) : (
            <div className="divide-y">
              {years.map((fy) => (
                <div
                  key={fy.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold">{fy.year}</span>
                    <Badge variant={statusVariant[fy.status] ?? "outline"}>
                      {fy.status}
                    </Badge>
                    {fy.is_active && (
                      <Badge className="bg-green-500 text-white hover:bg-green-600">
                        Active
                      </Badge>
                    )}
                  </div>
                  {!fy.is_active && fy.status !== "closed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSetActive(fy.id)}
                    >
                      Set Active
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
