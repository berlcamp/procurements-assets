import { getRoles, getRolePermissions } from "@/lib/actions/roles"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { Role, Permission } from "@/types/database"

async function RoleCard({ role }: { role: Role }) {
  const permissions = await getRolePermissions(role.id)

  const byModule = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.module]) acc[p.module] = []
    acc[p.module].push(p)
    return acc
  }, {})

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">{role.display_name}</CardTitle>
            <CardDescription className="mt-0.5 text-xs font-mono">
              {role.name}
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0">
            {role.scope}
          </Badge>
        </div>
        {role.description && (
          <p className="text-sm text-muted-foreground">{role.description}</p>
        )}
      </CardHeader>
      <CardContent>
        {Object.entries(byModule).length === 0 ? (
          <p className="text-xs text-muted-foreground">No permissions assigned.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(byModule).map(([module, perms]) => (
              <div key={module}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {module}
                </p>
                <div className="flex flex-wrap gap-1">
                  {perms.map((p) => (
                    <Badge key={p.id} variant="secondary" className="text-xs">
                      {p.code}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default async function RolesPage() {
  const roles = await getRoles()
  const divisionRoles = roles.filter((r) => r.scope !== "platform")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Roles</h1>
        <p className="text-muted-foreground">
          System roles and their permission assignments.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {divisionRoles.map((role) => (
          <RoleCard key={role.id} role={role} />
        ))}
      </div>
    </div>
  )
}
