import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import type { RequestWithDetails } from "@/types/database"
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
    marginBottom: 6,
  },
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
  colNo: { width: "6%" },
  colDesc: { width: "36%" },
  colUnit: { width: "10%" },
  colQtyReq: { width: "12%" },
  colQtyIss: { width: "12%" },
  colRemarks: { width: "24%" },
  purposeBox: {
    border: "1px solid #000",
    padding: "4 6",
    marginBottom: 8,
  },
  signaturesSection: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sigBlock: { width: "30%", textAlign: "center" },
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

interface Props {
  request: RequestWithDetails
  divisionName?: string
}

export function RisPdf({ request, divisionName }: Props) {
  const items = request.request_items ?? []
  const requestDate = format(new Date(request.created_at), "MMMM d, yyyy")

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerSection}>
          <Text style={styles.republic}>Republic of the Philippines</Text>
          <Text style={styles.agencyName}>{divisionName ?? "Schools Division Office"}</Text>
          <Text style={styles.republic}>Department of Education</Text>
          <Text style={styles.docTitle}>REQUISITION AND ISSUE SLIP</Text>
        </View>

        {/* Meta */}
        <View style={styles.metaRow}>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>RIS No.: </Text>
            {request.request_number}
          </Text>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Date: </Text>
            {requestDate}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Requesting Office/Section: </Text>
            {request.office?.name ?? "—"}
          </Text>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Requested by: </Text>
            {request.requested_by_profile
              ? `${request.requested_by_profile.first_name} ${request.requested_by_profile.last_name}`
              : "—"}
          </Text>
        </View>

        {/* Purpose */}
        <View style={styles.purposeBox}>
          <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 2, fontSize: 8 }}>Purpose / Justification:</Text>
          <Text>{request.purpose}</Text>
          <Text style={{ marginTop: 3, fontSize: 8, color: "#555" }}>
            Urgency: {request.urgency.charAt(0).toUpperCase() + request.urgency.slice(1)}
            {"  |  "}Type: {request.request_type.charAt(0).toUpperCase() + request.request_type.slice(1)}
          </Text>
        </View>

        {/* Items Table */}
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableCell, styles.colNo, { textAlign: "center" }]}>No.</Text>
            <Text style={[styles.tableCell, styles.colDesc]}>Stock / Property Description</Text>
            <Text style={[styles.tableCell, styles.colUnit, { textAlign: "center" }]}>Unit</Text>
            <Text style={[styles.tableCell, styles.colQtyReq, { textAlign: "center" }]}>Qty Requested</Text>
            <Text style={[styles.tableCell, styles.colQtyIss, { textAlign: "center" }]}>Qty Issued</Text>
            <Text style={[styles.tableCell, styles.colRemarks, { borderRight: "none" }]}>Remarks</Text>
          </View>

          {items.map((item, idx) => (
            <View key={item.id} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.colNo, { textAlign: "center" }]}>{idx + 1}</Text>
              <Text style={[styles.tableCell, styles.colDesc]}>
                {item.item_catalog?.name ?? item.description}
                {item.item_catalog?.code ? `\nCode: ${item.item_catalog.code}` : ""}
              </Text>
              <Text style={[styles.tableCell, styles.colUnit, { textAlign: "center" }]}>{item.unit}</Text>
              <Text style={[styles.tableCell, styles.colQtyReq, { textAlign: "center" }]}>{item.quantity_requested}</Text>
              <Text style={[styles.tableCell, styles.colQtyIss, { textAlign: "center" }]}>
                {parseFloat(item.quantity_issued) > 0 ? item.quantity_issued : "—"}
              </Text>
              <Text style={[styles.tableCell, styles.colRemarks, { borderRight: "none" }]}>
                {item.remarks ?? ""}
              </Text>
            </View>
          ))}

          {items.length < 5 &&
            Array.from({ length: 5 - items.length }).map((_, i) => (
              <View key={`empty-${i}`} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.colNo]}> </Text>
                <Text style={[styles.tableCell, styles.colDesc]}> </Text>
                <Text style={[styles.tableCell, styles.colUnit]}> </Text>
                <Text style={[styles.tableCell, styles.colQtyReq]}> </Text>
                <Text style={[styles.tableCell, styles.colQtyIss]}> </Text>
                <Text style={[styles.tableCell, styles.colRemarks, { borderRight: "none" }]}> </Text>
              </View>
            ))}
        </View>

        {/* Signature Blocks */}
        <View style={styles.signaturesSection}>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Requested by:</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>
              {request.requested_by_profile
                ? `${request.requested_by_profile.first_name} ${request.requested_by_profile.last_name}`
                : "_________________________"}
            </Text>
            {request.requested_by_profile?.position && (
              <Text style={styles.sigPosition}>{request.requested_by_profile.position}</Text>
            )}
            <Text style={styles.sigPosition}>Date: {requestDate}</Text>
          </View>

          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Approved by / Authorized by:</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>
              {request.supervisor_profile
                ? `${request.supervisor_profile.first_name} ${request.supervisor_profile.last_name}`
                : "_________________________"}
            </Text>
            <Text style={styles.sigPosition}>Section Chief / School Head</Text>
            {request.supervisor_approved_at && (
              <Text style={styles.sigPosition}>
                Date: {format(new Date(request.supervisor_approved_at), "MMM d, yyyy")}
              </Text>
            )}
          </View>

          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Issued by:</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>
              {request.processed_by_profile
                ? `${request.processed_by_profile.first_name} ${request.processed_by_profile.last_name}`
                : "_________________________"}
            </Text>
            <Text style={styles.sigPosition}>Supply Officer</Text>
            <Text style={styles.sigPosition}>Date: _______________</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>RIS No. {request.request_number} | Generated from PABMS</Text>
          <Text>This document is system-generated. Verify with official records.</Text>
        </View>
      </Page>
    </Document>
  )
}
