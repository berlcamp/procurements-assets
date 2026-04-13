import { Suspense } from "react"
import { Globe, Download, Copy, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getPhilGepsData } from "@/lib/actions/documents"
import { getFiscalYears } from "@/lib/actions/budget"
import { PhilGepsClient } from "./philgeps-client"

export default async function PhilGepsPage() {
  const [entries, fiscalYears] = await Promise.all([
    getPhilGepsData(),
    getFiscalYears().catch(() => []),
  ])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="h-6 w-6 text-primary" />
            PhilGEPS Data Preparation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Prepare and export procurement data for PhilGEPS posting. Review entries, copy reference data, and track posting status.
          </p>
        </div>
      </div>

      {/* Info card */}
      <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
        <CardContent className="pt-4 pb-3">
          <div className="flex gap-3 text-sm">
            <Globe className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-blue-900 dark:text-blue-100">About PhilGEPS</p>
              <p className="text-blue-700 dark:text-blue-300 mt-0.5">
                Philippine Government Electronic Procurement System (PhilGEPS) requires publication of procurement
                opportunities for competitive bidding. Use the data below to fill in PhilGEPS forms or export for
                upload. Once posted, update the PhilGEPS Reference No. in the procurement activity.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Client-side interactive table */}
      <PhilGepsClient entries={entries} fiscalYears={fiscalYears} />
    </div>
  )
}
