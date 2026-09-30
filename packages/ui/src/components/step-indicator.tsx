// Divergence 5 (DIVERGENCES.md): the step indicator of the create flow
// (Sources → Choose Views → Open). shadcn has no stepper; this is Badge and
// Separator laid out with flex. Tokens only.
import { CheckIcon } from "lucide-react"
import { cn } from "cn"

import { Badge } from "@seply/ui/components/badge"
import { Separator } from "@seply/ui/components/separator"

function StepIndicator({
  steps,
  current,
  className,
  ...props
}: React.ComponentProps<"ol"> & {
  /** Step labels, in order. */
  steps: readonly string[]
  /** The current step's index (0-based); earlier steps show as done. */
  current: number
}) {
  return (
    <ol
      data-slot="step-indicator"
      aria-label="Steps"
      className={cn("flex items-center gap-2 text-sm", className)}
      {...props}
    >
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo"
        return (
          <li
            key={label}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className="flex items-center gap-2"
          >
            {i > 0 && (
              <span aria-hidden className="w-6 sm:w-10">
                <Separator />
              </span>
            )}
            <Badge
              variant={state === "todo" ? "outline" : state === "done" ? "secondary" : "default"}
              className="size-6 rounded-full p-0 tabular-nums"
            >
              {state === "done" ? <CheckIcon aria-label="done" /> : i + 1}
            </Badge>
            <span
              className={cn(
                "whitespace-nowrap",
                state === "current" ? "font-medium text-foreground" : "text-muted-foreground",
                state === "todo" && "hidden sm:inline"
              )}
            >
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export { StepIndicator }
