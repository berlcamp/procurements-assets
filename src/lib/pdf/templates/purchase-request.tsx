import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import type { PurchaseRequestWithDetails } from "@/types/database"
import { format } from "date-fns"

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 40,
    color: "#000",
  },
  headerSection: {
    textAlign: "center",
    marginBottom: 8,
  },
  republic: {
    fontSize: 8,
    marginBottom: 1,
  },
  agencyName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 1,
  },
  docTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    textDecoration: "underline",
    marginTop: 4,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  metaCell: {
    fontSize: 9,
  },
  metaLabel: {
    fontFamily: "Helvetica-Bold",
  },
  table: {
    borderTop: "1px solid #000",
    borderLeft: "1px solid #000",
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "1px solid #000",
  },
  tableHeader: {
    backgroundColor: "#e5e5e5",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  tableCell: {
    borderRight: "1px solid #000",
    padding: "3 4",
  },
  colNo: { width: "6%" },
  colDesc: { width: "44%" },
  colUnit: { width: "10%" },
  colQty: { width: "10%" },
  colUnitCost: { width: "15%" },
  colTotalCost: { width: "15%" },
  totalRow: {
    flexDirection: "row",
    borderBottom: "1px solid #000",
    backgroundColor: "#f0f0f0",
  },
  signaturesSection: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sigBlock: {
    width: "30%",
    textAlign: "center",
  },
  sigLine: {
    borderBottom: "1px solid #000",
    marginBottom: 2,
    height: 20,
    marginTop: 14,
  },
  sigLabel: {
    fontSize: 8,
    color: "#555",
  },
  sigName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  sigPosition: {
    fontSize: 7,
    color: "#555",
  },
  purposeBox: {
    border: "1px solid #000",
    padding: "4 6",
    marginBottom: 8,
  },
  purposeLabel: {
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
    fontSize: 8,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7,
    color: "#888",
    flexDirection: "row",
    justifyContent: "space-between",
  },
})

function formatPeso(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "0.00"
  const n = typeof val === "string" ? parseFloat(val) : val
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface Props {
  pr: PurchaseRequestWithDetails
  divisionName?: string
}

export function PurchaseRequestPdf({ pr, divisionName }: Props) {
  const items = pr.pr_items ?? []
  const requestDate = pr.requested_at
    ? format(new Date(pr.requested_at), "MMMM d, yyyy")
    : format(new Date(pr.created_at), "MMMM d, yyyy")

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerSection}>
          <Text style={styles.republic}>Republic of the Philippines</Text>
          <Text style={styles.agencyName}>
            {divisionName ?? "Schools Division Office"}
          </Text>
          <Text style={styles.republic}>Department of Education</Text>
          <Text style={styles.docTitle}>PURCHASE REQUEST</Text>
        </View>

        {/* Meta */}
        <View style={styles.metaRow}>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>PR No.: </Text>
            {pr.pr_number}
          </Text>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Date: </Text>
            {requestDate}
          </Text>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>FY: </Text>
            {pr.fiscal_year?.year}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Office/Section: </Text>
            {pr.office?.name}
          </Text>
          {pr.fund_source && (
            <Text style={styles.metaCell}>
              <Text style={styles.metaLabel}>Fund: </Text>
              {pr.fund_source.name}
            </Text>
          )}
          {pr.procurement_mode && (
            <Text style={styles.metaCell}>
              <Text style={styles.metaLabel}>Mode: </Text>
              {pr.procurement_mode.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
            </Text>
          )}
        </View>

        {/* Purpose */}
        <View style={styles.purposeBox}>
          <Text style={styles.purposeLabel}>Purpose / Justification:</Text>
          <Text>{pr.purpose}</Text>
        </View>

        {/* OBR reference if available */}
        {pr.obr && (
          <View style={[styles.metaRow, { marginBottom: 6 }]}>
            <Text style={styles.metaCell}>
              <Text style={styles.metaLabel}>OBR No.: </Text>
              {pr.obr.obr_number}
            </Text>
          </View>
        )}

        {/* Items Table */}
        <View style={styles.table}>
          {/* Header */}
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableCell, styles.colNo, { textAlign: "center" }]}>No.</Text>
            <Text style={[styles.tableCell, styles.colDesc]}>Description / Specification</Text>
            <Text style={[styles.tableCell, styles.colUnit, { textAlign: "center" }]}>Unit</Text>
            <Text style={[styles.tableCell, styles.colQty, { textAlign: "center" }]}>Qty</Text>
            <Text style={[styles.tableCell, styles.colUnitCost, { textAlign: "right" }]}>Unit Cost</Text>
            <Text style={[styles.tableCell, styles.colTotalCost, { textAlign: "right", borderRight: "none" }]}>Total Cost</Text>
          </View>

          {/* Items */}
          {items.map((item) => (
            <View key={item.id} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.colNo, { textAlign: "center" }]}>{item.item_number}</Text>
              <Text style={[styles.tableCell, styles.colDesc]}>{item.description}</Text>
              <Text style={[styles.tableCell, styles.colUnit, { textAlign: "center" }]}>{item.unit}</Text>
              <Text style={[styles.tableCell, styles.colQty, { textAlign: "center" }]}>{item.quantity}</Text>
              <Text style={[styles.tableCell, styles.colUnitCost, { textAlign: "right" }]}>
                {formatPeso(item.estimated_unit_cost)}
              </Text>
              <Text style={[styles.tableCell, styles.colTotalCost, { textAlign: "right", borderRight: "none" }]}>
                {formatPeso(item.estimated_total_cost)}
              </Text>
            </View>
          ))}

          {/* Empty rows for aesthetics if few items */}
          {items.length < 5 &&
            Array.from({ length: 5 - items.length }).map((_, i) => (
              <View key={`empty-${i}`} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.colNo]}> </Text>
                <Text style={[styles.tableCell, styles.colDesc]}> </Text>
                <Text style={[styles.tableCell, styles.colUnit]}> </Text>
                <Text style={[styles.tableCell, styles.colQty]}> </Text>
                <Text style={[styles.tableCell, styles.colUnitCost]}> </Text>
                <Text style={[styles.tableCell, styles.colTotalCost, { borderRight: "none" }]}> </Text>
              </View>
            ))}

          {/* Total row */}
          <View style={styles.totalRow}>
            <Text style={[styles.tableCell, { width: "70%", fontFamily: "Helvetica-Bold", textAlign: "right" }]}>
              TOTAL ESTIMATED COST:
            </Text>
            <Text style={[styles.tableCell, { width: "30%", textAlign: "right", borderRight: "none", fontFamily: "Helvetica-Bold" }]}>
              PHP {formatPeso(pr.total_estimated_cost)}
            </Text>
          </View>
        </View>

        {/* ABC if present */}
        {pr.abc_ceiling && (
          <Text style={[styles.metaCell, { marginBottom: 6 }]}>
            <Text style={styles.metaLabel}>Approved Budget for the Contract (ABC): </Text>
            PHP {formatPeso(pr.abc_ceiling)}
          </Text>
        )}

        {/* Signature Blocks */}
        <View style={styles.signaturesSection}>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Requested by:</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>
              {pr.requester
                ? `${pr.requester.first_name} ${pr.requester.last_name}`
                : "_________________________"}
            </Text>
            {pr.requester?.position && (
              <Text style={styles.sigPosition}>{pr.requester.position}</Text>
            )}
          </View>

          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Budget Availability Certified by:</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>_________________________</Text>
            <Text style={styles.sigPosition}>Budget Officer</Text>
            {pr.budget_certified_at && (
              <Text style={styles.sigPosition}>
                {format(new Date(pr.budget_certified_at), "MMM d, yyyy")}
              </Text>
            )}
          </View>

          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Approved by:</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>_________________________</Text>
            <Text style={styles.sigPosition}>Schools Division Superintendent</Text>
            {pr.approved_at && (
              <Text style={styles.sigPosition}>
                {format(new Date(pr.approved_at), "MMM d, yyyy")}
              </Text>
            )}
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>PR No. {pr.pr_number} | Generated from PABMS</Text>
          <Text>This document is system-generated. Verify with official records.</Text>
        </View>
      </Page>
    </Document>
  )
}
