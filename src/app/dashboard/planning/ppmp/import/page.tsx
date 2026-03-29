import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { UploadIcon } from "lucide-react"

export default function PpmpImportPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Import PPMPs</h1>
          <p className="text-sm text-muted-foreground">Bulk import from CSV or Excel</p>
        </div>
        <Link href="/dashboard/planning/ppmp">
          <Button variant="outline" size="sm">Back to list</Button>
        </Link>
      </div>
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UploadIcon className="h-5 w-5" />
            Bulk Import
          </CardTitle>
          <CardDescription>
            Import PPMP items from a CSV or Excel template
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Bulk import will be available in a future release. Please use the manual entry form for now.
          </p>
          <Link href="/dashboard/planning/ppmp/new" className="mt-4 block">
            <Button variant="outline" size="sm">Create PPMP manually</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
