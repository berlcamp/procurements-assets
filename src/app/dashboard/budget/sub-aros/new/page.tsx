import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SubAroForm } from "@/components/budget/sub-aro-form"
import { getUserPermissions } from "@/lib/actions/roles"
import { Forbidden } from "@/components/shared/forbidden"

export default async function NewSubAroPage() {
  const permissions = await getUserPermissions()
  const canCreate = permissions.includes("budget.create") || permissions.includes("budget.certify")

  if (!canCreate) return <Forbidden />

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Record Sub-ARO</h1>
        <p className="text-muted-foreground text-sm">
          Record a Sub-Allotment Release Order received from Central/Regional Office
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sub-ARO Details</CardTitle>
          <CardDescription>
            Budget allocations can be linked to this Sub-ARO to trace their funding authority.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SubAroForm />
        </CardContent>
      </Card>
    </div>
  )
}
