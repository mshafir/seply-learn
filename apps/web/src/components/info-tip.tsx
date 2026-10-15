// A detail behind an info icon (what an ask costs, what a setting does):
// useful when someone looks for it, but not worth a line of its own.
import { InfoIcon } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@seply/ui/components/tooltip"

export function InfoTip({
  text,
  "data-testid": testId,
}: {
  text: string
  "data-testid"?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={text}
        data-testid={testId}
        className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <InfoIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  )
}
