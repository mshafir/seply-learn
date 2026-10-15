// A read-only value with a Copy button: a command, an address, a prompt.
// Used by the setup page (connect-screen.tsx) and Settings → Connected agents.
import { CopyIcon } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@seply/ui/components/input-group"

import { copyText } from "@/lib/clipboard.ts"

export function CopyField({
  id,
  value,
  label,
}: {
  id: string
  value: string
  label: string
}) {
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        readOnly
        value={value}
        className="font-mono text-xs"
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={`Copy ${label}`}
          onClick={() => void copyText(value)}
        >
          <CopyIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
