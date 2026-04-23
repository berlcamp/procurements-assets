"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { softDeleteSaro } from "@/lib/actions/budget"

export function DeleteSaroButton({
  id,
  saroNumber,
}: {
  id: string
  saroNumber: string
}) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (
      !confirm(`Delete SARO ${saroNumber}? This cannot be undone from the UI.`)
    ) {
      return
    }

    setDeleting(true)
    const result = await softDeleteSaro(id)
    if (result.error) {
      toast.error(result.error)
      setDeleting(false)
      return
    }
    toast.success("SARO deleted.")
    router.push("/dashboard/budget/saros")
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleDelete}
      disabled={deleting}
    >
      <Trash2 className="mr-1.5 h-4 w-4" />
      {deleting ? "Deleting…" : "Delete"}
    </Button>
  )
}
