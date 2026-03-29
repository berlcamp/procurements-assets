import { cn } from "@/lib/utils"

export interface TrackerStep {
  id: string
  label: string
  status: "completed" | "current" | "pending" | "error"
  description?: string
}

interface WorkflowTrackerProps {
  steps: TrackerStep[]
  className?: string
}

export function WorkflowTracker({ steps, className }: WorkflowTrackerProps) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                step.status === "completed" && "bg-green-100 text-green-700",
                step.status === "current" && "bg-blue-100 text-blue-700 ring-2 ring-blue-300",
                step.status === "pending" && "bg-gray-100 text-gray-400",
                step.status === "error" && "bg-red-100 text-red-700",
              )}
            >
              {step.status === "completed" ? "\u2713" : i + 1}
            </div>
            <span
              className={cn(
                "mt-1 text-[10px] leading-tight text-center max-w-[60px]",
                step.status === "completed" && "text-green-700",
                step.status === "current" && "text-blue-700 font-medium",
                step.status === "pending" && "text-gray-400",
                step.status === "error" && "text-red-700",
              )}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "h-0.5 w-6 mb-4",
                step.status === "completed" ? "bg-green-300" : "bg-gray-200",
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}
