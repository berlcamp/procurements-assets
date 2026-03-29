import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InfoIcon } from "lucide-react"

export default function ObligationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Obligations (OBR)</h1>
        <p className="text-muted-foreground">
          Obligation Requests linked to purchase orders and procurement activities.
        </p>
      </div>

      <Card className="border-blue-200 bg-blue-50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-blue-800 text-base">
            <InfoIcon className="h-4 w-4" />
            Coming in Phase 11
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription className="text-blue-700">
            Obligation Requests (OBRs) are generated automatically when Purchase Orders are
            issued in Phase 11 (Purchase Orders &amp; Delivery). Budget availability is
            checked against allocations in real time using{" "}
            <code className="bg-blue-100 px-1 rounded text-xs">check_budget_availability()</code>.
          </CardDescription>
          <div className="mt-4 flex gap-2">
            <Link href="/dashboard/budget/allocations">
              <Button variant="outline" size="sm" className="border-blue-300 text-blue-800 hover:bg-blue-100">
                View Allocations
              </Button>
            </Link>
            <Link href="/dashboard/budget">
              <Button variant="ghost" size="sm" className="text-blue-700">
                Back to Budget Dashboard
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
