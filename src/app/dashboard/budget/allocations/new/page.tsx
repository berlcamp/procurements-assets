import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AllocationForm } from "@/components/budget/allocation-form"

export default function NewAllocationPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Budget Allocation</h1>
        <p className="text-muted-foreground">
          Create a budget allocation line for an office, fund source, and account code.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Allocation Details</CardTitle>
          <CardDescription>
            The original amount will be set as the initial adjusted amount.
            Subsequent adjustments go through an approval workflow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AllocationForm />
        </CardContent>
      </Card>
    </div>
  )
}
