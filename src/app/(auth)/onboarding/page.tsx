"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { completeOnboarding, getAvailableDivisions, getOfficesForDivision } from "@/lib/actions/onboarding"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"

interface Division {
  id: string
  name: string
  code: string
  region: string
}

interface OfficeOption {
  id: string
  name: string
  code: string
  office_type: string
}

export default function OnboardingPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [divisions, setDivisions] = useState<Division[]>([])
  const [loadingDivisions, setLoadingDivisions] = useState(true)

  // Profile fields
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [middleName, setMiddleName] = useState("")
  const [suffix, setSuffix] = useState("")
  const [position, setPosition] = useState("")

  // Division selection
  const [divisionTab, setDivisionTab] = useState("existing")
  const [selectedDivisionId, setSelectedDivisionId] = useState("")

  // New division fields
  const [divName, setDivName] = useState("")
  const [divCode, setDivCode] = useState("")
  const [divRegion, setDivRegion] = useState("")

  // Office selection
  const [offices, setOffices] = useState<OfficeOption[]>([])
  const [selectedOfficeId, setSelectedOfficeId] = useState("")
  const [loadingOffices, setLoadingOffices] = useState(false)

  useEffect(() => {
    async function loadDivisions() {
      const list = await getAvailableDivisions()
      setDivisions(list)
      if (list.length === 0) setDivisionTab("new")
      setLoadingDivisions(false)
    }
    loadDivisions()
  }, [])

  // Load offices when a division is selected
  useEffect(() => {
    if (!selectedDivisionId) {
      setOffices([])
      setSelectedOfficeId("")
      return
    }
    let cancelled = false
    async function loadOffices() {
      setLoadingOffices(true)
      const list = await getOfficesForDivision(selectedDivisionId)
      if (!cancelled) {
        setOffices(list)
        setSelectedOfficeId("")
        setLoadingOffices(false)
      }
    }
    loadOffices()
    return () => { cancelled = true }
  }, [selectedDivisionId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First name and last name are required.")
      return
    }

    if (divisionTab === "existing" && !selectedDivisionId) {
      toast.error("Please select a division.")
      return
    }

    if (divisionTab === "new" && (!divName.trim() || !divCode.trim() || !divRegion.trim())) {
      toast.error("Division name, code, and region are required.")
      return
    }

    setSubmitting(true)

    const { error, requestSubmitted } = await completeOnboarding({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      middle_name: middleName.trim() || undefined,
      suffix: suffix.trim() || undefined,
      position: position.trim() || undefined,
      office_id: divisionTab === "existing" && selectedOfficeId ? selectedOfficeId : undefined,
      division_id: divisionTab === "existing" ? selectedDivisionId : undefined,
      new_division:
        divisionTab === "new"
          ? { name: divName.trim(), code: divCode.trim(), region: divRegion.trim() }
          : undefined,
    })

    if (error) {
      toast.error(error)
      setSubmitting(false)
      return
    }

    if (requestSubmitted) {
      toast.success("Your join request has been submitted for approval.")
      router.push("/pending-approval")
      return
    }

    toast.success("Welcome! Your account is ready.")
    router.push("/dashboard")
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-lg space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Welcome to DepEd PAS</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete your profile to get started.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Your Information</CardTitle>
              <CardDescription>
                This will be used across the system.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="first_name">
                    First Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="first_name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name">
                    Last Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="last_name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="middle_name">Middle Name</Label>
                  <Input
                    id="middle_name"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="suffix">Suffix</Label>
                  <Input
                    id="suffix"
                    value={suffix}
                    onChange={(e) => setSuffix(e.target.value)}
                    placeholder="Jr., III, etc."
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="position">Position / Designation</Label>
                <Input
                  id="position"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Division</CardTitle>
              <CardDescription>
                Select the DepEd division you belong to, or create a new one.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingDivisions ? (
                <p className="text-sm text-muted-foreground">Loading divisions...</p>
              ) : (
                <Tabs value={divisionTab} onValueChange={setDivisionTab}>
                  {divisions.length > 0 && (
                    <TabsList className="mb-4 w-full">
                      <TabsTrigger value="existing" className="flex-1">
                        Join Existing
                      </TabsTrigger>
                      <TabsTrigger value="new" className="flex-1">
                        Create New
                      </TabsTrigger>
                    </TabsList>
                  )}

                  <TabsContent value="existing" className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Joining an existing division requires approval from a division administrator.
                    </p>
                    <div className="space-y-2">
                      <Label>Select Division <span className="text-destructive">*</span></Label>
                      <Select
                        value={selectedDivisionId}
                        onValueChange={(v) => setSelectedDivisionId(v ?? "")}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a division" />
                        </SelectTrigger>
                        <SelectContent>
                          {divisions.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name} ({d.code}) — {d.region}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedDivisionId && (
                      <div className="space-y-2">
                        <Label>Office / School</Label>
                        {loadingOffices ? (
                          <p className="text-sm text-muted-foreground">Loading offices...</p>
                        ) : offices.length > 0 ? (
                          <Select
                            value={selectedOfficeId}
                            onValueChange={(v) => setSelectedOfficeId(v === "none" ? "" : v ?? "")}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select your office or school" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— Not sure / Will set later —</SelectItem>
                              {offices.map((o) => (
                                <SelectItem key={o.id} value={o.id}>
                                  {o.name} ({o.code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No offices configured yet. Your admin can assign one later.
                          </p>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="new" className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="div_name">
                        Division Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="div_name"
                        value={divName}
                        onChange={(e) => setDivName(e.target.value)}
                        placeholder="e.g. Division of Quezon City"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="div_code">
                          Code <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="div_code"
                          value={divCode}
                          onChange={(e) => setDivCode(e.target.value)}
                          placeholder="e.g. QC"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="div_region">
                          Region <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          id="div_region"
                          value={divRegion}
                          onChange={(e) => setDivRegion(e.target.value)}
                          placeholder="e.g. NCR"
                        />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>

          <Button type="submit" className="mt-4 w-full" disabled={submitting}>
            {submitting ? "Setting up your account..." : "Complete Setup"}
          </Button>
        </form>
      </div>
    </div>
  )
}
