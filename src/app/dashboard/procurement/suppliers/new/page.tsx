import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SupplierForm } from "@/components/procurement/supplier-form"

export default function NewSupplierPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard/procurement/suppliers" />}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-xl font-bold">Add Supplier</h1>
          <p className="text-sm text-muted-foreground">Register a new supplier in the division registry</p>
        </div>
      </div>
      <SupplierForm />
    </div>
  )
}
