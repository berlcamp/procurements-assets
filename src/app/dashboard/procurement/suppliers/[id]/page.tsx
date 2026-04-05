import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/shared/status-badge"
import { getSupplierById } from "@/lib/actions/procurement"
import { format } from "date-fns"

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supplier = await getSupplierById(id)
  if (!supplier) notFound()

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">{supplier.name}</h1>
            <StatusBadge status={supplier.status} />
          </div>
          {supplier.trade_name && (
            <p className="text-sm text-muted-foreground">DBA: {supplier.trade_name}</p>
          )}
          <p className="text-sm font-mono text-muted-foreground">{supplier.tin}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/dashboard/procurement/suppliers/${id}/edit`} />}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard/procurement/suppliers" />}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
        </div>
      </div>

      {supplier.status === "blacklisted" && supplier.blacklist_reason && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-red-800">Blacklisted Supplier</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-red-700 space-y-1">
            <p><strong>Reason:</strong> {supplier.blacklist_reason}</p>
            {supplier.blacklist_date && (
              <p><strong>Date:</strong> {format(new Date(supplier.blacklist_date), "MMMM d, yyyy")}</p>
            )}
            {supplier.blacklist_until && (
              <p><strong>Until:</strong> {format(new Date(supplier.blacklist_until), "MMMM d, yyyy")}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Business Details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          <div><p className="text-muted-foreground">TIN</p><p className="font-mono">{supplier.tin}</p></div>
          {supplier.philgeps_number && (
            <div><p className="text-muted-foreground">PhilGEPS No.</p><p className="font-mono">{supplier.philgeps_number}</p></div>
          )}
          {supplier.business_type && (
            <div><p className="text-muted-foreground">Business Type</p><p>{supplier.business_type}</p></div>
          )}
          {supplier.classification.length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-muted-foreground mb-1">Classification</p>
              <div className="flex flex-wrap gap-1">
                {supplier.classification.map(c => (
                  <Badge key={c} variant="outline">{c}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {(supplier.address || supplier.city || supplier.province) && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Address</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {supplier.address && <p>{supplier.address}</p>}
            <p>{[supplier.city, supplier.province, supplier.zip_code].filter(Boolean).join(", ")}</p>
          </CardContent>
        </Card>
      )}

      {(supplier.contact_person || supplier.contact_number || supplier.email) && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Contact</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            {supplier.contact_person && (
              <div><p className="text-muted-foreground">Contact Person</p><p>{supplier.contact_person}</p></div>
            )}
            {supplier.contact_number && (
              <div><p className="text-muted-foreground">Number</p><p>{supplier.contact_number}</p></div>
            )}
            {supplier.email && (
              <div><p className="text-muted-foreground">Email</p><p>{supplier.email}</p></div>
            )}
            {supplier.website && (
              <div><p className="text-muted-foreground">Website</p>
                <a href={supplier.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block">{supplier.website}</a>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
