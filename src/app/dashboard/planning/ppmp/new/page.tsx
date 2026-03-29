import Link from "next/link"
import { PpmpForm } from "@/components/planning/ppmp-form"
import { Button } from "@/components/ui/button"

export default function NewPpmpPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">New PPMP</h1>
          <p className="text-sm text-muted-foreground">
            Create a new Project Procurement Management Plan
          </p>
        </div>
        <Link href="/dashboard/planning/ppmp">
          <Button variant="outline" size="sm">Back to list</Button>
        </Link>
      </div>
      <PpmpForm />
    </div>
  )
}
