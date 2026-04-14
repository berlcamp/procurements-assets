import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SaroForm } from "@/components/budget/saro-form"
import { getUserPermissions } from "@/lib/actions/roles"
import { Forbidden } from "@/components/shared/forbidden"

export default async function NewSaroPage() {
  const permissions = await getUserPermissions()
  const canCreate = permissions.includes("budget.create") || permissions.includes("budget.certify")

  if (!canCreate) return <Forbidden />

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Record SARO</h1>
        <p className="text-muted-foreground text-sm">
          Record a Special Allotment Release Order issued by DBM
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SARO Details</CardTitle>
          <CardDescription>
            Budget allocations can be linked to this SARO to trace their funding authority.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SaroForm />
        </CardContent>
      </Card>
    </div>
  )
}
