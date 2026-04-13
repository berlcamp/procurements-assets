import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { createElement } from "react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAssetById, getAssetAssignments } from "@/lib/actions/assets"
import { IcsPdf } from "@/lib/pdf/templates/ics"

// Route: /api/documents/ics/[assignmentId]
// [id] here is the assignment ID, not asset ID
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Fetch assignment by id
  const admin = createAdminClient()
  const { data: assignmentData } = await admin
    .schema("procurements")
    .from("asset_assignments")
    .select("*, office:offices(id, name, code)")
    .eq("id", id)
    .single()

  if (!assignmentData) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
  }

  const asset = await getAssetById(assignmentData.asset_id)
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 })
  }

  // Get custodian profile
  const assignments = await getAssetAssignments({ asset_id: asset.id })
  const assignment = assignments.find(a => a.id === id) ?? { ...assignmentData, custodian_profile: null, assigned_by_profile: null }

  // Get division name
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
    const element = createElement(IcsPdf, { asset, assignment, divisionName })
    const pdfBuffer = await renderToBuffer(element as any)

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="ICS-${assignmentData.document_number}.pdf"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    console.error("PDF generation error:", err)
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 })
  }
}
