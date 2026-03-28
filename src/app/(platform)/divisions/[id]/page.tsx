import Link from "next/link"
import { notFound } from "next/navigation"
import { getDivisionById } from "@/lib/actions/divisions"
import { StatusBadge } from "@/components/shared/status-badge"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { DivisionActions } from "./division-actions"

export default async function DivisionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const division = await getDivisionById(id)

  if (!division) {
    notFound()
  }

  function formatDate(iso: string | null): string {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("en-PH", { dateStyle: "medium" })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{division.name}</h1>
          <p className="text-muted-foreground">{division.region}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/platform/divisions/${id}/settings`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Edit
          </Link>
          <DivisionActions division={division} />
        </div>
      </div>

      {/* Basic info */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Division Code
              </dt>
              <dd className="mt-1 font-mono text-sm">{division.code}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Region
              </dt>
              <dd className="mt-1 text-sm">{division.region}</dd>
            </div>
            {division.address && (
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-muted-foreground">
                  Address
                </dt>
                <dd className="mt-1 text-sm">{division.address}</dd>
              </div>
            )}
            {division.contact_number && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Contact Number
                </dt>
                <dd className="mt-1 text-sm">{division.contact_number}</dd>
              </div>
            )}
            {division.email && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Email
                </dt>
                <dd className="mt-1 text-sm">{division.email}</dd>
              </div>
            )}
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Created
              </dt>
              <dd className="mt-1 text-sm">{formatDate(division.created_at)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Onboarded
              </dt>
              <dd className="mt-1 text-sm">
                {formatDate(division.onboarded_at)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Subscription info */}
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>
            Current plan and usage limits for this division.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Status
              </dt>
              <dd className="mt-1">
                <StatusBadge status={division.subscription_status} />
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Plan
              </dt>
              <dd className="mt-1 text-sm capitalize">
                {division.subscription_plan}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Max Users
              </dt>
              <dd className="mt-1 text-sm">
                {division.max_users.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">
                Max Schools
              </dt>
              <dd className="mt-1 text-sm">
                {division.max_schools.toLocaleString()}
              </dd>
            </div>
            {division.trial_ends_at && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Trial Ends
                </dt>
                <dd className="mt-1 text-sm">
                  {formatDate(division.trial_ends_at)}
                </dd>
              </div>
            )}
            {division.subscription_starts_at && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Subscription Start
                </dt>
                <dd className="mt-1 text-sm">
                  {formatDate(division.subscription_starts_at)}
                </dd>
              </div>
            )}
            {division.subscription_ends_at && (
              <div>
                <dt className="text-sm font-medium text-muted-foreground">
                  Subscription End
                </dt>
                <dd className="mt-1 text-sm">
                  {formatDate(division.subscription_ends_at)}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
