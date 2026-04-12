"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  setDirectContractingJustification,
  setEmergencyDetails,
  setNegotiationDetails,
  setAgencyToAgencyDetails,
} from "@/lib/actions/procurement-activities"
import type { ProcurementActivityWithDetails } from "@/types/database"

interface MethodSpecificFieldsProps {
  activity: ProcurementActivityWithDetails
  canEdit: boolean
}

export function MethodSpecificFields({ activity, canEdit }: MethodSpecificFieldsProps) {
  const m = activity.procurement_method
  if (!["direct_contracting", "emergency", "negotiated", "agency_to_agency"].includes(m)) {
    return null
  }

  return (
    <div className="space-y-3">
      {m === "direct_contracting" && (
        <DirectContractingFields activity={activity} canEdit={canEdit} />
      )}
      {m === "emergency" && (
        <EmergencyFields activity={activity} canEdit={canEdit} />
      )}
      {m === "negotiated" && (
        <NegotiatedFields activity={activity} canEdit={canEdit} />
      )}
      {m === "agency_to_agency" && (
        <AgencyToAgencyFields activity={activity} canEdit={canEdit} />
      )}
    </div>
  )
}

function DirectContractingFields({ activity, canEdit }: { activity: ProcurementActivityWithDetails; canEdit: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [type, setType] = useState(activity.justification_type ?? "")
  const [text, setText] = useState(activity.justification_text ?? "")
  const [priceNote, setPriceNote] = useState(activity.price_reasonableness_note ?? "")

  async function handleSave() {
    setLoading(true)
    const result = await setDirectContractingJustification({
      procurement_id: activity.id,
      justification_type: type,
      justification_text: text,
      price_reasonableness_note: priceNote,
    })
    setLoading(false)
    if (result.error) { toast.error(result.error); return }
    toast.success("Justification saved")
    router.refresh()
  }

  return (
    <>
      <div className="space-y-1">
        <Label>Justification Type</Label>
        {canEdit ? (
          <Select value={type} onValueChange={(v) => setType(v ?? "")}>
            <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="proprietary">Proprietary — only one source</SelectItem>
              <SelectItem value="exclusive_dealer">Exclusive Dealer — sole distributor</SelectItem>
              <SelectItem value="critical_component">Critical Component — compatibility</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm capitalize">{type.replace(/_/g, " ") || "—"}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label>Written Justification</Label>
        {canEdit ? (
          <Textarea value={text} onChange={e => setText(e.target.value)} rows={3}
            placeholder="Explain why this item can only be obtained from this supplier..." />
        ) : (
          <p className="text-sm whitespace-pre-wrap">{text || "—"}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label>Price Reasonableness Note</Label>
        {canEdit ? (
          <Textarea value={priceNote} onChange={e => setPriceNote(e.target.value)} rows={2}
            placeholder="Evidence that the price is fair and reasonable..." />
        ) : (
          <p className="text-sm whitespace-pre-wrap">{priceNote || "—"}</p>
        )}
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Justification"}
          </Button>
        </div>
      )}
    </>
  )
}

function EmergencyFields({ activity, canEdit }: { activity: ProcurementActivityWithDetails; canEdit: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [type, setType] = useState(activity.emergency_type ?? "")
  const [justification, setJustification] = useState(activity.emergency_justification ?? "")
  const [purchaseDate, setPurchaseDate] = useState(activity.emergency_purchase_date ?? "")

  async function handleSave() {
    setLoading(true)
    const result = await setEmergencyDetails({
      procurement_id: activity.id,
      emergency_type: type,
      emergency_justification: justification,
      emergency_purchase_date: purchaseDate,
    })
    setLoading(false)
    if (result.error) { toast.error(result.error); return }
    toast.success("Emergency details saved")
    router.refresh()
  }

  return (
    <>
      <div className="space-y-1">
        <Label>Emergency Type</Label>
        {canEdit ? (
          <Select value={type} onValueChange={(v) => setType(v ?? "")}>
            <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="calamity">Calamity / Natural Disaster</SelectItem>
              <SelectItem value="imminent_danger">Imminent Danger to Life/Property</SelectItem>
              <SelectItem value="other">Other Urgent Circumstance</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm capitalize">{type.replace(/_/g, " ") || "—"}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label>Emergency Justification</Label>
        {canEdit ? (
          <Textarea value={justification} onChange={e => setJustification(e.target.value)} rows={3}
            placeholder="Describe the emergency and why immediate purchase was necessary..." />
        ) : (
          <p className="text-sm whitespace-pre-wrap">{justification || "—"}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label>Emergency Purchase Date</Label>
        {canEdit ? (
          <Input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
        ) : (
          <p className="text-sm">{purchaseDate || "—"}</p>
        )}
      </div>
      {activity.emergency_review_deadline && (
        <p className="text-xs text-amber-700">
          BAC post-review deadline: {activity.emergency_review_deadline}
        </p>
      )}
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Emergency Details"}
          </Button>
        </div>
      )}
    </>
  )
}

function NegotiatedFields({ activity, canEdit }: { activity: ProcurementActivityWithDetails; canEdit: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [records, setRecords] = useState(activity.negotiation_records_note ?? "")

  async function handleSave() {
    setLoading(true)
    const result = await setNegotiationDetails({
      procurement_id: activity.id,
      negotiation_records_note: records,
    })
    setLoading(false)
    if (result.error) { toast.error(result.error); return }
    toast.success("Negotiation records saved")
    router.refresh()
  }

  return (
    <>
      <div className="space-y-1">
        <Label>Negotiation Records</Label>
        {canEdit ? (
          <Textarea value={records} onChange={e => setRecords(e.target.value)} rows={4}
            placeholder="Summary of BAC negotiation with the supplier — terms discussed, agreed-upon price, and any conditions..." />
        ) : (
          <p className="text-sm whitespace-pre-wrap">{records || "—"}</p>
        )}
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Negotiation Records"}
          </Button>
        </div>
      )}
    </>
  )
}

function AgencyToAgencyFields({ activity, canEdit }: { activity: ProcurementActivityWithDetails; canEdit: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [agency, setAgency] = useState(activity.partner_agency_name ?? "")
  const [moaRef, setMoaRef] = useState(activity.moa_reference ?? "")
  const [moaDate, setMoaDate] = useState(activity.moa_date ?? "")

  async function handleSave() {
    setLoading(true)
    const result = await setAgencyToAgencyDetails({
      procurement_id: activity.id,
      partner_agency_name: agency,
      moa_reference: moaRef,
      moa_date: moaDate,
    })
    setLoading(false)
    if (result.error) { toast.error(result.error); return }
    toast.success("Agency-to-Agency details saved")
    router.refresh()
  }

  return (
    <>
      <div className="space-y-1">
        <Label>Partner Government Agency</Label>
        {canEdit ? (
          <Input value={agency} onChange={e => setAgency(e.target.value)}
            placeholder="e.g. Department of Education — Central Office" />
        ) : (
          <p className="text-sm">{agency || "—"}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label>MOA/MOU Reference</Label>
        {canEdit ? (
          <Input value={moaRef} onChange={e => setMoaRef(e.target.value)}
            placeholder="e.g. MOA-2026-014" />
        ) : (
          <p className="text-sm font-mono">{moaRef || "—"}</p>
        )}
      </div>
      <div className="space-y-1">
        <Label>MOA/MOU Date</Label>
        {canEdit ? (
          <Input type="date" value={moaDate} onChange={e => setMoaDate(e.target.value)} />
        ) : (
          <p className="text-sm">{moaDate || "—"}</p>
        )}
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save Agency Details"}
          </Button>
        </div>
      )}
    </>
  )
}
