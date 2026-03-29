import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AdjustmentForm } from "@/components/budget/adjustment-form"

export default function NewAdjustmentPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Request Budget Adjustment</h1>
        <p className="text-muted-foreground">
          Submit a realignment, augmentation, reduction, or transfer for approval.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Adjustment Details</CardTitle>
          <CardDescription>
            This request will be forwarded to the Division Chief or HOPE for approval.
            Once approved, the budget allocation will be automatically updated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdjustmentForm />
        </CardContent>
      </Card>
    </div>
  )
}
