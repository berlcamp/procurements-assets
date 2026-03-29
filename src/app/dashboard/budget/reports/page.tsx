import {
  getActiveFiscalYear,
  getBudgetUtilizationByOffice,
  getBudgetUtilizationByFundSource,
  getFiscalYears,
} from "@/lib/actions/budget"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { AmountDisplay } from "@/components/shared/amount-display"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"

export default async function BudgetReportsPage() {
  const fiscalYear = await getActiveFiscalYear()

  const [byOffice, byFundSource] = fiscalYear
    ? await Promise.all([
        getBudgetUtilizationByOffice(fiscalYear.id),
        getBudgetUtilizationByFundSource(fiscalYear.id),
      ])
    : [[], []]

  const grandTotal = byOffice.reduce(
    (acc, row) => {
      acc.adjusted += parseFloat(row.total_adjusted)
      acc.obligated += parseFloat(row.total_obligated)
      acc.disbursed += parseFloat(row.total_disbursed)
      acc.available += parseFloat(row.total_available)
      return acc
    },
    { adjusted: 0, obligated: 0, disbursed: 0, available: 0 }
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Budget Reports</h1>
        <p className="text-muted-foreground text-sm">
          {fiscalYear
            ? `Fiscal Year ${fiscalYear.year} utilization summary`
            : "No active fiscal year"}
        </p>
      </div>

      {/* Grand total */}
      {fiscalYear && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Total Budget", value: grandTotal.adjusted },
            { label: "Obligated", value: grandTotal.obligated },
            { label: "Disbursed", value: grandTotal.disbursed },
            { label: "Available", value: grandTotal.available },
          ].map((s) => (
            <Card key={s.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {s.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AmountDisplay amount={s.value} className="text-xl font-bold" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* By Office */}
      <Card>
        <CardHeader>
          <CardTitle>Utilization by Office</CardTitle>
          <CardDescription>Budget utilization breakdown per office</CardDescription>
        </CardHeader>
        <CardContent>
          {byOffice.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data for this fiscal year.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Office</TableHead>
                  <TableHead className="text-right">Adjusted</TableHead>
                  <TableHead className="text-right">Obligated</TableHead>
                  <TableHead className="text-right">Disbursed</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Utilization %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byOffice.map((row) => (
                  <TableRow key={row.office_id}>
                    <TableCell>
                      <p className="font-medium">{row.office_name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{row.office_code}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={row.total_adjusted} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={row.total_obligated} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={row.total_disbursed} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={row.total_available} />
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`font-mono text-sm font-medium ${
                          parseFloat(row.utilization_pct) > 90
                            ? "text-red-600"
                            : parseFloat(row.utilization_pct) > 70
                            ? "text-yellow-600"
                            : "text-emerald-600"
                        }`}
                      >
                        {parseFloat(row.utilization_pct).toFixed(1)}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}

                {/* Totals row */}
                <TableRow className="border-t-2 font-bold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">
                    <AmountDisplay amount={grandTotal.adjusted} className="font-bold" />
                  </TableCell>
                  <TableCell className="text-right">
                    <AmountDisplay amount={grandTotal.obligated} className="font-bold" />
                  </TableCell>
                  <TableCell className="text-right">
                    <AmountDisplay amount={grandTotal.disbursed} className="font-bold" />
                  </TableCell>
                  <TableCell className="text-right">
                    <AmountDisplay amount={grandTotal.available} className="font-bold" />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-sm font-bold">
                      {grandTotal.adjusted > 0
                        ? ((grandTotal.obligated / grandTotal.adjusted) * 100).toFixed(1)
                        : "0.0"}%
                    </span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* By Fund Source */}
      <Card>
        <CardHeader>
          <CardTitle>Utilization by Fund Source</CardTitle>
          <CardDescription>Budget utilization breakdown per fund source</CardDescription>
        </CardHeader>
        <CardContent>
          {byFundSource.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data for this fiscal year.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fund Source</TableHead>
                  <TableHead className="text-right">Adjusted</TableHead>
                  <TableHead className="text-right">Obligated</TableHead>
                  <TableHead className="text-right">Disbursed</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Utilization %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byFundSource.map((row) => (
                  <TableRow key={row.fund_source_id}>
                    <TableCell>
                      <p className="font-medium">{row.fund_source_name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{row.fund_source_code}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={row.total_adjusted} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={row.total_obligated} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={row.total_disbursed} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountDisplay amount={row.total_available} />
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`font-mono text-sm font-medium ${
                          parseFloat(row.utilization_pct) > 90
                            ? "text-red-600"
                            : parseFloat(row.utilization_pct) > 70
                            ? "text-yellow-600"
                            : "text-emerald-600"
                        }`}
                      >
                        {parseFloat(row.utilization_pct).toFixed(1)}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
