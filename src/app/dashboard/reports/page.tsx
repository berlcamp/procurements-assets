import Link from "next/link"
import { BarChart2, Wallet, ShoppingCart, Package, ShieldCheck } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getUserPermissions } from "@/lib/actions/roles"

interface ReportCard {
  title: string
  description: string
  href: string
  icon: React.ReactNode
  permissions: string[]
}

const REPORTS: ReportCard[] = [
  {
    title: "Budget Utilization",
    description: "Budget allocation, obligation, and disbursement breakdown by office and fund source.",
    href: "/dashboard/budget/reports",
    icon: <Wallet className="h-5 w-5 text-emerald-500" />,
    permissions: ["budget.view_all", "reports.all"],
  },
  {
    title: "Procurement Monitoring",
    description: "Procurement activities by method, status, awarded amounts, and savings analysis.",
    href: "/dashboard/reports/procurement",
    icon: <ShoppingCart className="h-5 w-5 text-blue-500" />,
    permissions: ["proc.manage", "reports.all"],
  },
  {
    title: "Asset Registry (RPCPPE)",
    description: "Property, Plant, and Equipment registry with depreciation and semi-expendable tracking.",
    href: "/dashboard/assets/reports",
    icon: <Package className="h-5 w-5 text-orange-500" />,
    permissions: ["asset.manage", "reports.all"],
  },
  {
    title: "Compliance Summary",
    description: "Document completeness, asset accountability, and OBR certification compliance scores.",
    href: "/dashboard/reports/compliance",
    icon: <ShieldCheck className="h-5 w-5 text-purple-500" />,
    permissions: ["reports.all"],
  },
]

export default async function ReportCenterPage() {
  const permissions = await getUserPermissions()
  const permSet = new Set(permissions)

  const visibleReports = REPORTS.filter((r) =>
    r.permissions.some((p) => permSet.has(p))
  )

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <BarChart2 className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Report Center</h1>
          <p className="text-sm text-muted-foreground">
            Select a report to view detailed analytics and export data.
          </p>
        </div>
      </div>

      {visibleReports.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No reports available for your role.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {visibleReports.map((r) => (
            <Link key={r.href} href={r.href}>
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    {r.icon}
                    <CardTitle className="text-base">{r.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>{r.description}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
