import Link from "next/link"
import { getUsers } from "@/lib/actions/users"
import { getOffices } from "@/lib/actions/offices"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Users, Building2, ShieldCheck, Settings } from "lucide-react"

export default async function AdminDashboardPage() {
  const [users, offices] = await Promise.all([getUsers(), getOffices()])

  const stats = [
    {
      label: "Users",
      value: users.length,
      description: "Active division users",
      icon: Users,
      href: "/dashboard/admin/users",
    },
    {
      label: "Offices",
      value: offices.length,
      description: "Offices and schools",
      icon: Building2,
      href: "/dashboard/admin/offices",
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Division Administration</h1>
        <p className="text-muted-foreground">
          Manage offices, users, roles, and division settings.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{s.label}</CardTitle>
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{s.value}</div>
                <p className="text-xs text-muted-foreground">{s.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Roles &amp; Permissions
            </CardTitle>
            <CardDescription>
              View system roles and their permission assignments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/admin/roles" className="block w-full">
              <Button variant="outline" className="w-full">View Roles</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Division Settings
            </CardTitle>
            <CardDescription>
              Configure system settings for your division.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/admin/settings" className="block w-full">
              <Button variant="outline" className="w-full">Open Settings</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
