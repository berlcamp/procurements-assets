import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import type { PurchaseOrderWithDetails } from "@/types/database"
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
  republic: { fontSize: 8, marginBottom: 1 },
  agencyName: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 1 },
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
    marginBottom: 5,
  },
  metaCell: { fontSize: 9 },
  metaLabel: { fontFamily: "Helvetica-Bold" },
  infoBox: {
    border: "1px solid #000",
    padding: "4 6",
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  infoCol: { width: "48%" },
  infoField: { marginBottom: 3 },
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
  colDesc: { width: "38%" },
  colUnit: { width: "8%" },
  colQty: { width: "8%" },
  colUnitCost: { width: "20%" },
  colTotalCost: { width: "20%" },
  totalRow: {
    flexDirection: "row",
    borderBottom: "1px solid #000",
    backgroundColor: "#f0f0f0",
  },
  termsBox: {
    border: "1px solid #000",
    padding: "4 6",
    marginBottom: 8,
    fontSize: 8,
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
  bold: { fontFamily: "Helvetica-Bold" },
})

function formatPeso(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "0.00"
  const n = typeof val === "string" ? parseFloat(val) : val
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface Props {
  po: PurchaseOrderWithDetails
  divisionName?: string
}

export function PurchaseOrderPdf({ po, divisionName }: Props) {
  const items = po.po_items ?? []
  const issueDate = po.issued_at
    ? format(new Date(po.issued_at), "MMMM d, yyyy")
    : po.approved_at
    ? format(new Date(po.approved_at), "MMMM d, yyyy")
    : format(new Date(po.created_at), "MMMM d, yyyy")

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerSection}>
          <Text style={styles.republic}>Republic of the Philippines</Text>
          <Text style={styles.agencyName}>{divisionName ?? "Schools Division Office"}</Text>
          <Text style={styles.republic}>Department of Education</Text>
          <Text style={styles.docTitle}>PURCHASE ORDER</Text>
        </View>

        {/* PO Meta */}
        <View style={styles.metaRow}>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>PO No.: </Text>{po.po_number}
          </Text>
          <Text style={styles.metaCell}>
            <Text style={styles.metaLabel}>Date: </Text>{issueDate}
          </Text>
          {po.fiscal_year && (
            <Text style={styles.metaCell}>
              <Text style={styles.metaLabel}>FY: </Text>{po.fiscal_year.year}
            </Text>
          )}
        </View>

        {/* Supplier & Delivery Info */}
        <View style={styles.infoBox}>
          <View style={styles.infoCol}>
            <View style={styles.infoField}>
              <Text style={styles.metaLabel}>Supplier / Payee:</Text>
              <Text>{po.supplier?.name ?? "—"}</Text>
              {po.supplier?.trade_name && <Text style={{ fontSize: 8, color: "#555" }}>{po.supplier.trade_name}</Text>}
            </View>
            <View style={styles.infoField}>
              <Text>
                <Text style={styles.bold}>TIN: </Text>{po.supplier?.tin ?? "—"}
              </Text>
            </View>
            {po.procurement?.procurement_number && (
              <View style={styles.infoField}>
                <Text>
                  <Text style={styles.bold}>Procurement No.: </Text>
                  {po.procurement.procurement_number}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.infoCol}>
            {po.delivery_date && (
              <View style={styles.infoField}>
                <Text>
                  <Text style={styles.bold}>Delivery Date: </Text>
                  {format(new Date(po.delivery_date), "MMMM d, yyyy")}
                </Text>
              </View>
            )}
            {po.delivery_address && (
              <View style={styles.infoField}>
                <Text style={styles.metaLabel}>Delivery Address:</Text>
                <Text>{po.delivery_address}</Text>
              </View>
            )}
            {po.payment_terms && (
              <View style={styles.infoField}>
                <Text>
                  <Text style={styles.bold}>Payment Terms: </Text>{po.payment_terms}
                </Text>
              </View>
            )}
            {po.office?.name && (
              <View style={styles.infoField}>
                <Text>
                  <Text style={styles.bold}>Requesting Office: </Text>{po.office.name}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Procurement method label */}
        {po.procurement?.procurement_method && (
          <Text style={[styles.metaCell, { marginBottom: 6 }]}>
            <Text style={styles.metaLabel}>Procurement Method: </Text>
            {po.procurement.procurement_method.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
          </Text>
        )}

        {/* Items Table */}
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableCell, styles.colNo, { textAlign: "center" }]}>No.</Text>
            <Text style={[styles.tableCell, styles.colDesc]}>Item Description</Text>
            <Text style={[styles.tableCell, styles.colUnit, { textAlign: "center" }]}>Unit</Text>
            <Text style={[styles.tableCell, styles.colQty, { textAlign: "center" }]}>Qty</Text>
            <Text style={[styles.tableCell, styles.colUnitCost, { textAlign: "right" }]}>Unit Cost (PHP)</Text>
            <Text style={[styles.tableCell, styles.colTotalCost, { textAlign: "right", borderRight: "none" }]}>Total Cost (PHP)</Text>
          </View>

          {items.map((item, index) => (
            <View key={item.id} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.colNo, { textAlign: "center" }]}>{index + 1}</Text>
              <Text style={[styles.tableCell, styles.colDesc]}>{item.description}</Text>
              <Text style={[styles.tableCell, styles.colUnit, { textAlign: "center" }]}>{item.unit}</Text>
              <Text style={[styles.tableCell, styles.colQty, { textAlign: "center" }]}>{item.quantity}</Text>
              <Text style={[styles.tableCell, styles.colUnitCost, { textAlign: "right" }]}>
                {formatPeso(item.unit_cost)}
              </Text>
              <Text style={[styles.tableCell, styles.colTotalCost, { textAlign: "right", borderRight: "none" }]}>
                {formatPeso(item.total_cost)}
              </Text>
            </View>
          ))}

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

          <View style={styles.totalRow}>
            <Text style={[styles.tableCell, { width: "80%", fontFamily: "Helvetica-Bold", textAlign: "right" }]}>
              TOTAL AMOUNT:
            </Text>
            <Text style={[styles.tableCell, { width: "20%", textAlign: "right", borderRight: "none", fontFamily: "Helvetica-Bold" }]}>
              PHP {formatPeso(po.total_amount)}
            </Text>
          </View>
        </View>

        {/* ABC & Contract */}
        {po.procurement?.abc_amount && (
          <Text style={[styles.metaCell, { marginBottom: 3 }]}>
            <Text style={styles.metaLabel}>ABC: </Text>PHP {formatPeso(po.procurement.abc_amount)}
            {po.procurement.contract_amount && (
              <>{"  "}
                <Text style={styles.metaLabel}>  Contract Amount: </Text>PHP {formatPeso(po.procurement.contract_amount)}
              </>
            )}
          </Text>
        )}

        {/* Terms box */}
        <View style={styles.termsBox}>
          <Text>
            This order is subject to the terms and conditions of the Government Procurement Reform Act (RA 9184/RA 12009)
            and its Implementing Rules and Regulations (IRR). The supplier/contractor warrants that goods/services delivered
            conform to the specifications stated herein.
          </Text>
        </View>

        {/* Signatures */}
        <View style={styles.signaturesSection}>
          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Issued by:</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>_________________________</Text>
            <Text style={styles.sigPosition}>Supply / Procurement Officer</Text>
          </View>

          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Approved by:</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>_________________________</Text>
            <Text style={styles.sigPosition}>Schools Division Superintendent</Text>
            {po.approved_at && (
              <Text style={styles.sigPosition}>{format(new Date(po.approved_at), "MMM d, yyyy")}</Text>
            )}
          </View>

          <View style={styles.sigBlock}>
            <Text style={styles.sigLabel}>Received by / Acknowledged by:</Text>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>_________________________</Text>
            <Text style={styles.sigPosition}>Supplier Representative</Text>
            <Text style={styles.sigPosition}>Date: _______________</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>PO No. {po.po_number} | Generated from PABMS</Text>
          <Text>This document is system-generated. Verify with official records.</Text>
        </View>
      </Page>
    </Document>
  )
}
