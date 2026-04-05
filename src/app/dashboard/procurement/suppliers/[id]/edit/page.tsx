import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SupplierForm } from "@/components/procurement/supplier-form"
import { getSupplierById } from "@/lib/actions/procurement"

export default async function EditSupplierPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supplier = await getSupplierById(id)
  if (!supplier) notFound()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/dashboard/procurement/suppliers/${id}`} />}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-xl font-bold">Edit Supplier</h1>
          <p className="text-sm text-muted-foreground">{supplier.name}</p>
        </div>
      </div>
      <SupplierForm defaultValues={supplier} />
    </div>
  )
}
