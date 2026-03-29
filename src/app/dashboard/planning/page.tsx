import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChevronRightIcon, ClipboardList, ScrollText } from "lucide-react"

export default function PlanningPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Planning Module</h1>
        <p className="text-sm text-muted-foreground">
          PPMP preparation, approval, and Annual Procurement Plan (APP) management
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* PPMP Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Project Procurement Management Plan</CardTitle>
            </div>
            <CardDescription>
              Office-level procurement planning per fiscal year. Prepare, submit, and track PPMP approval.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/planning/ppmp">
              <Button variant="outline" size="sm" className="w-full">
                Go to PPMP <ChevronRightIcon className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* APP Card */}
        <Card className="opacity-60">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Annual Procurement Plan</CardTitle>
            </div>
            <CardDescription>
              Division-wide procurement plan auto-populated from approved PPMPs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" className="w-full" disabled>
              Go to APP <ChevronRightIcon className="ml-1 h-3.5 w-3.5" />
            </Button>
            <p className="mt-2 text-xs text-muted-foreground text-center">
              Available after PPMPs are approved. Coming soon.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
