import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import type { AssetWithDetails, AssetAssignmentWithDetails } from "@/types/database"
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
  headerSection: { textAlign: "center", marginBottom: 8 },
  republic: { fontSize: 8, marginBottom: 1 },
  agencyName: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 1 },
  docTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    textDecoration: "underline",
    marginTop: 4,
    marginBottom: 2,
  },
  docSubtitle: { fontSize: 9, marginBottom: 6, color: "#555" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  metaCell: { fontSize: 9 },
  metaLabel: { fontFamily: "Helvetica-Bold" },
  table: {
    borderTop: "1px solid #000",
    borderLeft: "1px solid #000",
    marginBottom: 8,
  },
  tableRow: { flexDirection: "row", borderBottom: "1px solid #000" },
  tableHeader: { backgroundColor: "#e5e5e5", fontFamily: "Helvetica-Bold", fontSize: 8 },
  tableCell: { borderRight: "1px solid #000", padding: "3 4" },
  colQty: { width: "8%" },
  colUnit: { width: "8%" },
  colDesc: { width: "36%" },
  colPropNo: { width: "16%" },
  colDateAcq: { width: "14%" },
  colAcqCost: { width: "18%" },
  remarksBox: {
    border: "1px solid #000",
    padding: "4 6",
    marginBottom: 8,
    minHeight: 30,
  },
  signaturesSection: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sigBlock: { width: "45%", textAlign: "center" },
  sigLine: { borderBottom: "1px solid #000", marginBottom: 2, height: 20, marginTop: 14 },
  sigLabel: { fontSize: 8, color: "#555" },
  sigName: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  sigPosition: { fontSize: 7, color: "#555" },
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
  asset: AssetWithDetails
  assignment: AssetAssignmentWithDetails
  divisionName?: string
}

export function IcsPdf({ asset, assignment, divisionName }: Props) {
  const assignDate = assignment.assigned_date
    ? format(new Date(assignment.assigned_date), "MMMM d, yyyy")
    : ""

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerSection}>
          <Text style={styles.republic}>Republic of the Philippines</Text>
          <Text style={styles.agencyName}>{divisionName ?? "Schools Division Office"}</Text>
          <Text style={styles.republic}>Department of Education</Text>
          <Text style={styles.docTitle}>INVENTORY CUSTODIAN SLIP</Text>
          <Text style={styles.docSubtitle}>(For Semi-Expendable Property)</Text>
        </View>

        {/* Meta */}
        <View style={styles.metaRow}>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>ICS No.: </Text>
            {assignment.document_number}
          </Text>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Date: </Text>
            {assignDate}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Custodian / End User: </Text>
            {assignment.custodian_profile
              ? `${assignment.custodian_profile.first_name} ${assignment.custodian_profile.last_name}`
              : "—"}
          </Text>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Office: </Text>
            {assignment.office?.name ?? asset.office?.name ?? "—"}
          </Text>
        </View>

        {/* Items Table */}
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableCell, styles.colQty, { textAlign: "center" }]}>Qty</Text>
            <Text style={[styles.tableCell, styles.colUnit, { textAlign: "center" }]}>Unit</Text>
            <Text style={[styles.tableCell, styles.colDesc]}>Description / Item</Text>
            <Text style={[styles.tableCell, styles.colPropNo, { textAlign: "center" }]}>Property No.</Text>
            <Text style={[styles.tableCell, styles.colDateAcq, { textAlign: "center" }]}>Date Acquired</Text>
            <Text style={[styles.tableCell, styles.colAcqCost, { textAlign: "right", borderRight: "none" }]}>Acquisition Cost (PHP)</Text>
          </View>

          <View style={styles.tableRow}>
            <Text style={[styles.tableCell, styles.colQty, { textAlign: "center" }]}>1</Text>
            <Text style={[styles.tableCell, styles.colUnit, { textAlign: "center" }]}>pc</Text>
            <Text style={[styles.tableCell, styles.colDesc]}>
              {asset.description ?? asset.item_catalog?.name ?? "—"}
              {asset.brand_model ? `\n${asset.brand_model}` : ""}
              {asset.serial_number ? `\nS/N: ${asset.serial_number}` : ""}
            </Text>
            <Text style={[styles.tableCell, styles.colPropNo, { textAlign: "center" }]}>
              {asset.property_number}
            </Text>
            <Text style={[styles.tableCell, styles.colDateAcq, { textAlign: "center" }]}>
              {asset.acquisition_date}
            </Text>
            <Text style={[styles.tableCell, styles.colAcqCost, { textAlign: "right", borderRight: "none" }]}>
              {formatPeso(asset.acquisition_cost)}
            </Text>
          </View>

          {/* Padding rows */}
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.colQty]}> </Text>
              <Text style={[styles.tableCell, styles.colUnit]}> </Text>
              <Text style={[styles.tableCell, styles.colDesc]}> </Text>
              <Text style={[styles.tableCell, styles.colPropNo]}> </Text>
              <Text style={[styles.tableCell, styles.colDateAcq]}> </Text>
              <Text style={[styles.tableCell, styles.colAcqCost, { borderRight: "none" }]}> </Text>
            </View>
          ))}

          {/* Total */}
          <View style={[styles.tableRow, { backgroundColor: "#f0f0f0" }]}>
            <Text style={[styles.tableCell, { width: "72%", fontFamily: "Helvetica-Bold", textAlign: "right" }]}>TOTAL:</Text>
            <Text style={[styles.tableCell, { width: "28%", textAlign: "right", borderRight: "none", fontFamily: "Helvetica-Bold" }]}>
              PHP {formatPeso(asset.acquisition_cost)}
            </Text>
          </View>
        </View>

        {/* Remarks */}
        <View style={styles.remarksBox}>
          <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 2, fontSize: 8 }}>Remarks:</Text>
          <Text>{assignment.remarks ?? "—"}</Text>
        </View>

        {/* Location */}
        {asset.location && (
          <Text style={[styles.metaCell, { marginBottom: 6 }]}>
            <Text style={styles.metaLabel}>Location / Area: </Text>{asset.location}
          </Text>
        )}

        {/* Signature Blocks */}
        <View style={styles.signaturesSection}>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Issued by / Recorded by:</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>_________________________</Text>
            <Text style={styles.sigPosition}>Property / Supply Officer</Text>
            <Text style={styles.sigPosition}>Date: _______________</Text>
          </View>

          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Received by / Accepted by:</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>
              {assignment.custodian_profile
                ? `${assignment.custodian_profile.first_name} ${assignment.custodian_profile.last_name}`
                : "_________________________"}
            </Text>
            <Text style={styles.sigPosition}>Custodian / End User</Text>
            <Text style={styles.sigPosition}>Date: {assignDate || "_______________"}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>ICS No. {assignment.document_number} | Property No. {asset.property_number} | Generated from PABMS</Text>
          <Text>This document is system-generated. Verify with official records.</Text>
        </View>
      </Page>
    </Document>
  )
}
