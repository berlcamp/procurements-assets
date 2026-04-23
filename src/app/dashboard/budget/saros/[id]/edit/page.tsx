import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SaroForm } from "@/components/budget/saro-form"
import { getSaroById } from "@/lib/actions/budget"
import { getUserPermissions } from "@/lib/actions/roles"
import { Forbidden } from "@/components/shared/forbidden"

export default async function EditSaroPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [saro, permissions] = await Promise.all([
    getSaroById(id),
    getUserPermissions(),
  ])

  if (!saro) notFound()

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
          render={<Link href={`/dashboard/budget/saros/${saro.id}`} />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit SARO</h1>
          <p className="text-muted-foreground text-sm font-mono">{saro.saro_number}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SARO Details</CardTitle>
          <CardDescription>
            Update the details of this Special Allotment Release Order.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SaroForm saro={saro} />
        </CardContent>
      </Card>
    </div>
  )
}
