import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { createElement } from "react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getFuelRequestById } from "@/lib/actions/fuel"
import { TripTicketPdf } from "@/lib/pdf/templates/trip-ticket"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Fetch fuel request
  const fuelRequest = await getFuelRequestById(id)
  if (!fuelRequest) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Fetch division name for header
  const admin = createAdminClient()
  const { data: profile } = await admin
    .schema("procurements")
    .from("user_profiles")
    .select("division_id")
    .eq("id", user.id)
    .maybeSingle()

  let divisionName: string | undefined
  if (profile?.division_id) {
    const { data: division } = await admin
      .schema("platform")
      .from("divisions")
      .select("name")
      .eq("id", profile.division_id)
      .maybeSingle()
    divisionName = division?.name
  }

  try {
    const element = createElement(TripTicketPdf, { fuelRequest, divisionName })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await renderToBuffer(element as any)

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="TripTicket-${fuelRequest.request_number}.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    console.error("PDF generation error:", err)
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 })
  }
}
