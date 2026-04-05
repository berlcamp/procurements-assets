"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { addPpmpRemark, type PpmpRemark } from "@/lib/actions/ppmp"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SendIcon } from "lucide-react"

const STEP_LABELS: Record<string, string> = {
  chief_remark: "Section Chief",
  budget_officer_remark: "Budget Officer",
  hope_remark: "SDS / HOPE",
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

function timeAgo(date: string) {
  const d = new Date(date)
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

interface PpmpRemarksProps {
  ppmpId: string
  remarks: PpmpRemark[]
  canAddRemark: boolean
}

export function PpmpRemarks({ ppmpId, remarks, canAddRemark }: PpmpRemarksProps) {
  const [text, setText] = useState("")
  const [isPending, startTransition] = useTransition()
  const [localRemarks, setLocalRemarks] = useState(remarks)

  function handleSubmit() {
    const trimmed = text.trim()
    if (!trimmed) return
    startTransition(async () => {
      const result = await addPpmpRemark(ppmpId, trimmed)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Remark added")
      setText("")
      // Optimistic: append to local list (will be replaced on revalidation)
      setLocalRemarks((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          remarks: trimmed,
          acted_at: new Date().toISOString(),
          step_name: "you",
          actor_name: "You",
        },
      ])
    })
  }

  return (
    <div className="space-y-4">
      {localRemarks.length === 0 && !canAddRemark && (
        <p className="text-sm text-muted-foreground">No remarks yet.</p>
      )}

      {localRemarks.length > 0 && (
        <div className="space-y-3">
          {localRemarks.map((r) => (
            <div key={r.id} className="flex gap-3">
              <Avatar size="sm" className="mt-0.5 shrink-0">
                <AvatarFallback>{initials(r.actor_name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{r.actor_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {STEP_LABELS[r.step_name] ?? r.step_name}
                  </span>
                </div>
                <p className="mt-0.5 text-sm whitespace-pre-wrap break-words">
                  {r.remarks}
                </p>
                <span className="text-xs text-muted-foreground">{timeAgo(r.acted_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {canAddRemark && (
        <div className="flex gap-2 items-end">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a remark..."
            rows={2}
            className="min-h-[60px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSubmit()
              }
            }}
          />
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || !text.trim()}
            className="shrink-0"
          >
            <SendIcon className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
