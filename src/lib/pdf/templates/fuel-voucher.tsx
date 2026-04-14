import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import type { FuelRequestWithDetails } from "@/types/database"
import { format } from "date-fns"

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 50,
    color: "#000",
  },
  headerSection: { textAlign: "center", marginBottom: 12 },
  agencyName: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  subtext: { fontSize: 8, marginBottom: 1 },
  docTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    textDecoration: "underline",
    marginTop: 6,
    marginBottom: 10,
  },
  voucherNo: {
    textAlign: "right",
    fontSize: 9,
    marginBottom: 10,
  },
  fieldRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  fieldLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    width: "35%",
  },
  fieldValue: {
    fontSize: 9,
    width: "65%",
  },
  divider: {
    borderBottom: "1px solid #000",
    marginVertical: 8,
  },
  fuelBox: {
    border: "2px solid #000",
    padding: 12,
    marginVertical: 10,
    textAlign: "center",
  },
  fuelLabel: { fontSize: 10, marginBottom: 4 },
  fuelAmount: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
  },
  fuelUnit: { fontSize: 10, color: "#555" },
  signaturesSection: {
    marginTop: 24,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sigBlock: { width: "40%", textAlign: "center" },
  sigLine: {
    borderBottom: "1px solid #000",
    marginBottom: 2,
    height: 28,
    marginTop: 16,
  },
  sigName: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  sigPosition: { fontSize: 7, color: "#555" },
  sigLabel: { fontSize: 8, color: "#555" },
  notice: {
    marginTop: 16,
    border: "1px solid #666",
    padding: "6 8",
    textAlign: "center",
    fontSize: 8,
    color: "#555",
    fontFamily: "Helvetica-BoldOblique",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 50,
    right: 50,
    fontSize: 7,
    color: "#888",
    flexDirection: "row",
    justifyContent: "space-between",
  },
})

interface Props {
  fuelRequest: FuelRequestWithDetails
  divisionName?: string
}

export function FuelVoucherPdf({ fuelRequest, divisionName }: Props) {
  const requesterName = fuelRequest.requested_by_profile
    ? `${fuelRequest.requested_by_profile.first_name} ${fuelRequest.requested_by_profile.last_name}`
    : ""

  const approverName = fuelRequest.approved_by_profile
    ? `${fuelRequest.approved_by_profile.first_name} ${fuelRequest.approved_by_profile.last_name}`
    : ""

  const liters = parseFloat(
    fuelRequest.liters_approved ?? fuelRequest.liters_requested
  )

  return (
    <Document title={`FuelVoucher-${fuelRequest.request_number}`}>
      <Page size={[420, 595]} style={styles.page}>
        {/* Header */}
        <View style={styles.headerSection}>
          <Text style={styles.subtext}>Republic of the Philippines</Text>
          <Text style={styles.subtext}>Department of Education</Text>
          <Text style={styles.agencyName}>
            {divisionName ?? "SCHOOLS DIVISION OFFICE"}
          </Text>
          <Text style={styles.docTitle}>FUEL VOUCHER SLIP</Text>
        </View>

        {/* Voucher number */}
        <Text style={styles.voucherNo}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Voucher No.: </Text>
          {fuelRequest.request_number}
        </Text>

        {/* Details */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Date Approved:</Text>
          <Text style={styles.fieldValue}>
            {fuelRequest.approved_at
              ? format(new Date(fuelRequest.approved_at), "MMMM dd, yyyy")
              : "—"}
          </Text>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Driver / Requester:</Text>
          <Text style={styles.fieldValue}>{requesterName}</Text>
        </View>

        {fuelRequest.requested_by_profile?.position && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Position:</Text>
            <Text style={styles.fieldValue}>
              {fuelRequest.requested_by_profile.position}
            </Text>
          </View>
        )}

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Vehicle:</Text>
          <Text style={styles.fieldValue}>
            {fuelRequest.vehicle_type} — {fuelRequest.vehicle_plate_number}
          </Text>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Destination:</Text>
          <Text style={styles.fieldValue}>{fuelRequest.destination}</Text>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Purpose:</Text>
          <Text style={styles.fieldValue}>{fuelRequest.purpose}</Text>
        </View>

        <View style={styles.divider} />

        {/* Fuel Amount */}
        <View style={styles.fuelBox}>
          <Text style={styles.fuelLabel}>
            Authorized Fuel Allocation ({fuelRequest.fuel_type?.name ?? "Fuel"})
          </Text>
          <Text style={styles.fuelAmount}>
            {liters.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </Text>
          <Text style={styles.fuelUnit}>
            {fuelRequest.fuel_type?.unit ?? "liters"}
          </Text>
        </View>

        {/* Signatures */}
        <View style={styles.signaturesSection}>
          <View style={styles.sigBlock}>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>{requesterName}</Text>
            <Text style={styles.sigPosition}>Requester</Text>
          </View>
          <View style={styles.sigBlock}>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>{approverName}</Text>
            <Text style={styles.sigPosition}>Fuel Manager</Text>
            <Text style={styles.sigLabel}>Authorized By</Text>
          </View>
        </View>

        {/* Notice */}
        <Text style={styles.notice}>
          This voucher is valid for single use only. Present this slip at the
          authorized gasoline station.
        </Text>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Voucher No. {fuelRequest.request_number}</Text>
          <Text>
            Generated: {format(new Date(), "MMM dd, yyyy HH:mm")}
          </Text>
        </View>
      </Page>
    </Document>
  )
}
