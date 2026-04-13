import { ClipboardCheck } from "lucide-react"
import { getPendingApprovals } from "@/lib/actions/approvals"
import { ApprovalInboxClient } from "@/components/approvals/approval-inbox-client"

export default async function ApprovalsPage() {
  const items = await getPendingApprovals()

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Approval Inbox</h1>
          <p className="text-sm text-muted-foreground">
            {items.length} item{items.length !== 1 ? "s" : ""} awaiting your action
          </p>
        </div>
      </div>

      <ApprovalInboxClient items={items} />
    </div>
  )
}
