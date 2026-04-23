import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SubAroForm } from "@/components/budget/sub-aro-form"
import { getSubAroById } from "@/lib/actions/budget"
import { getUserPermissions } from "@/lib/actions/roles"
import { Forbidden } from "@/components/shared/forbidden"

export default async function EditSubAroPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [subAro, permissions] = await Promise.all([
    getSubAroById(id),
    getUserPermissions(),
  ])

  if (!subAro) notFound()

  const canEdit =
    permissions.includes("budget.create") || permissions.includes("budget.certify")
  if (!canEdit) return <Forbidden />

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          nativeButton={false}
          render={<Link href={`/dashboard/budget/sub-aros/${subAro.id}`} />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit Sub-ARO</h1>
          <p className="text-muted-foreground text-sm font-mono">{subAro.sub_aro_number}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sub-ARO Details</CardTitle>
          <CardDescription>
            Update the details of this Sub-Allotment Release Order.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SubAroForm subAro={subAro} />
        </CardContent>
      </Card>
    </div>
  )
}
