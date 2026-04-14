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
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  metaLabel: { fontFamily: "Helvetica-Bold" },
  // Bordered boxes
  fieldBox: {
    border: "1px solid #000",
    padding: "4 6",
    marginBottom: 6,
  },
  fieldLabel: { fontFamily: "Helvetica-Bold", fontSize: 8, marginBottom: 2 },
  fieldValue: { fontSize: 9 },
  // Table
  table: {
    borderTop: "1px solid #000",
    borderLeft: "1px solid #000",
    marginBottom: 8,
  },
  tableRow: { flexDirection: "row", borderBottom: "1px solid #000" },
  tableHeader: {
    backgroundColor: "#e5e5e5",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  tableCell: { borderRight: "1px solid #000", padding: "3 4" },
  colNo: { width: "8%" },
  colName: { width: "52%" },
  colPosition: { width: "40%" },
  // Two-column grid
  grid2: { flexDirection: "row", gap: 8, marginBottom: 6 },
  gridHalf: { width: "50%" },
  // Signatures
  signaturesSection: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sigBlock: { width: "40%", textAlign: "center" },
  sigLine: {
    borderBottom: "1px solid #000",
    marginBottom: 2,
    height: 24,
    marginTop: 14,
  },
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
  fuelRequest: FuelRequestWithDetails
  divisionName?: string
}

export function TripTicketPdf({ fuelRequest, divisionName }: Props) {
  const passengers = (fuelRequest.passengers ?? []) as Array<{
    name: string
    position: string
  }>

  const requesterName = fuelRequest.requested_by_profile
    ? `${fuelRequest.requested_by_profile.first_name} ${fuelRequest.requested_by_profile.last_name}`
    : ""

  const approverName = fuelRequest.approved_by_profile
    ? `${fuelRequest.approved_by_profile.first_name} ${fuelRequest.approved_by_profile.last_name}`
    : ""

  return (
    <Document title={`TripTicket-${fuelRequest.request_number}`}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerSection}>
          <Text style={styles.republic}>Republic of the Philippines</Text>
          <Text style={styles.republic}>Department of Education</Text>
          <Text style={styles.agencyName}>
            {divisionName ?? "SCHOOLS DIVISION OFFICE"}
          </Text>
          <Text style={styles.docTitle}>TRIP TICKET</Text>
        </View>

        {/* Meta row */}
        <View style={styles.metaRow}>
          <Text>
            <Text style={styles.metaLabel}>Trip Ticket No.: </Text>
            {fuelRequest.request_number}
          </Text>
          <Text>
            <Text style={styles.metaLabel}>Date: </Text>
            {format(new Date(fuelRequest.date_of_trip), "MMMM dd, yyyy")}
          </Text>
        </View>

        {/* Vehicle Info */}
        <View style={styles.grid2}>
          <View style={[styles.fieldBox, styles.gridHalf]}>
            <Text style={styles.fieldLabel}>Vehicle Type</Text>
            <Text style={styles.fieldValue}>{fuelRequest.vehicle_type}</Text>
          </View>
          <View style={[styles.fieldBox, styles.gridHalf]}>
            <Text style={styles.fieldLabel}>Plate Number</Text>
            <Text style={styles.fieldValue}>
              {fuelRequest.vehicle_plate_number}
            </Text>
          </View>
        </View>

        {/* Driver / Requester */}
        <View style={styles.fieldBox}>
          <Text style={styles.fieldLabel}>
            Name of Driver / Authorized Rider
          </Text>
          <Text style={styles.fieldValue}>{requesterName}</Text>
          {fuelRequest.requested_by_profile?.position && (
            <Text style={{ fontSize: 8, color: "#555" }}>
              {fuelRequest.requested_by_profile.position}
            </Text>
          )}
        </View>

        {/* Passengers */}
        {passengers.length > 0 && (
          <>
            <Text
              style={{
                fontFamily: "Helvetica-Bold",
                fontSize: 9,
                marginBottom: 4,
              }}
            >
              Passengers:
            </Text>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={[styles.tableCell, styles.colNo]}>No.</Text>
                <Text style={[styles.tableCell, styles.colName]}>Name</Text>
                <Text style={[styles.tableCell, styles.colPosition]}>
                  Position
                </Text>
              </View>
              {passengers.map((p, idx) => (
                <View key={idx} style={styles.tableRow}>
                  <Text style={[styles.tableCell, styles.colNo]}>
                    {idx + 1}
                  </Text>
                  <Text style={[styles.tableCell, styles.colName]}>
                    {p.name}
                  </Text>
                  <Text style={[styles.tableCell, styles.colPosition]}>
                    {p.position}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Destination & Purpose */}
        <View style={styles.grid2}>
          <View style={[styles.fieldBox, styles.gridHalf]}>
            <Text style={styles.fieldLabel}>Destination</Text>
            <Text style={styles.fieldValue}>{fuelRequest.destination}</Text>
          </View>
          <View style={[styles.fieldBox, styles.gridHalf]}>
            <Text style={styles.fieldLabel}>Office</Text>
            <Text style={styles.fieldValue}>
              {fuelRequest.office?.name ?? "—"}
            </Text>
          </View>
        </View>

        <View style={styles.fieldBox}>
          <Text style={styles.fieldLabel}>Purpose</Text>
          <Text style={styles.fieldValue}>{fuelRequest.purpose}</Text>
        </View>

        {/* Odometer & Fuel */}
        <View style={styles.grid2}>
          <View style={[styles.fieldBox, styles.gridHalf]}>
            <Text style={styles.fieldLabel}>Fuel Type</Text>
            <Text style={styles.fieldValue}>
              {fuelRequest.fuel_type?.name ?? "—"}
            </Text>
          </View>
          <View style={[styles.fieldBox, styles.gridHalf]}>
            <Text style={styles.fieldLabel}>
              Liters {fuelRequest.liters_approved ? "Approved" : "Requested"}
            </Text>
            <Text style={styles.fieldValue}>
              {parseFloat(
                fuelRequest.liters_approved ?? fuelRequest.liters_requested
              ).toLocaleString()}{" "}
              {fuelRequest.fuel_type?.unit ?? "liters"}
            </Text>
          </View>
        </View>

        {fuelRequest.km_departure && (
          <View style={styles.grid2}>
            <View style={[styles.fieldBox, styles.gridHalf]}>
              <Text style={styles.fieldLabel}>Odometer at Departure (km)</Text>
              <Text style={styles.fieldValue}>
                {parseFloat(fuelRequest.km_departure).toLocaleString()}
              </Text>
            </View>
            {fuelRequest.km_arrival && (
              <View style={[styles.fieldBox, styles.gridHalf]}>
                <Text style={styles.fieldLabel}>Odometer at Arrival (km)</Text>
                <Text style={styles.fieldValue}>
                  {parseFloat(fuelRequest.km_arrival).toLocaleString()}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Remarks */}
        {fuelRequest.approver_remarks && (
          <View style={styles.fieldBox}>
            <Text style={styles.fieldLabel}>Approver Remarks</Text>
            <Text style={styles.fieldValue}>
              {fuelRequest.approver_remarks}
            </Text>
          </View>
        )}

        {/* Signatures */}
        <View style={styles.signaturesSection}>
          <View style={styles.sigBlock}>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>{requesterName}</Text>
            <Text style={styles.sigPosition}>
              {fuelRequest.requested_by_profile?.position ?? "Requester"}
            </Text>
            <Text style={styles.sigLabel}>Requested By</Text>
          </View>
          <View style={styles.sigBlock}>
            <View style={styles.sigLine} />
            <Text style={styles.sigName}>{approverName}</Text>
            <Text style={styles.sigPosition}>Fuel Manager</Text>
            <Text style={styles.sigLabel}>Approved By</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Trip Ticket No. {fuelRequest.request_number}</Text>
          <Text>
            Generated:{" "}
            {format(new Date(), "MMM dd, yyyy HH:mm")}
          </Text>
        </View>
      </Page>
    </Document>
  )
}
