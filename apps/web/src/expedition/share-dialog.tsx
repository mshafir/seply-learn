// The share dialog (spec §3.9, WP-5.1): invite by email as an editor or a
// viewer, with a copyable invite link always offered (and an email when the
// server has a mailer); who has access, with the owner's controls (change a
// role, remove someone, make an editor the owner); pending invites; and the
// plain warning that anyone who can view sees the Sources. Editors invite;
// only the owner changes roles or removes people. Anyone but the owner may
// leave. WP-5.2 adds **General access** (Visibility: private, unlisted or
// public, the owner's to change; making it viewable beyond the people with
// access asks first, because the Sources become readable too) with the
// link to copy, **Fork** (anyone signed in who can view) and the owner's
// **Move to Trash**. Signed-in readers of a link open the dialog too: they
// see who has access and the Visibility, and can Fork. Export arrives with
// its work package.
import * as React from "react"
import {
  CheckIcon,
  CopyIcon,
  CrownIcon,
  EllipsisIcon,
  GitForkIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  LogOutIcon,
  Trash2Icon,
  UserMinusIcon,
  XIcon,
} from "lucide-react"

import { Alert, AlertDescription } from "@seply/ui/components/alert"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@seply/ui/components/avatar"
import { Badge } from "@seply/ui/components/badge"
import { Button } from "@seply/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@seply/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@seply/ui/components/dropdown-menu"
import { Field, FieldLabel } from "@seply/ui/components/field"
import { Input } from "@seply/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@seply/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@seply/ui/components/select"
import { Separator } from "@seply/ui/components/separator"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"

import {
  changeRole,
  forkExpedition,
  getSharing,
  invite,
  removeCollaborator,
  revokeInvite,
  setVisibility,
  transferOwnership,
  trashExpedition,
  type ForkResult,
  type InviteCreated,
  type InviteRole,
  type Role,
  type Sharing,
  type SharingPerson,
  type Visibility,
} from "@/lib/api.ts"
import { initials } from "@/screens/library-sections.ts"

const ROLE_ITEMS: { value: InviteRole; label: string }[] = [
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
]

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
}

const VISIBILITY: Record<
  Visibility,
  { label: string; hint: string; icon: typeof LockIcon }
> = {
  private: {
    label: "Private",
    hint: "Only the people with access can open it.",
    icon: LockIcon,
  },
  unlisted: {
    label: "Anyone with the link",
    hint: "Anyone with the link can read it, without signing in.",
    icon: LinkIcon,
  },
  public: {
    label: "Public",
    hint: "Anyone can find it in search and read it, without signing in.",
    icon: GlobeIcon,
  },
}

const VISIBILITY_ITEMS = (Object.keys(VISIBILITY) as Visibility[]).map(
  (value) => ({ value, label: VISIBILITY[value].label })
)

/** The link a reader of an unlisted or public Expedition opens. */
const expeditionLink = (expeditionId: string) =>
  `${window.location.origin}/e/${expeditionId}`

export function ShareDialog({
  open,
  onOpenChange,
  expeditionId,
  title,
  meId,
  onAccessChanged,
  onLeft,
  onForked,
  onTrashed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expeditionId: string
  title: string
  meId: string
  /** My own role changed here (I handed ownership on). */
  onAccessChanged: () => void
  /** I left the Expedition. */
  onLeft: () => void
  /** I forked it: open my copy. */
  onForked: (fork: ForkResult) => void
  /** I moved it to Trash. */
  onTrashed: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="share-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share {title || "this Expedition"}</DialogTitle>
          <DialogDescription>
            Anyone who can view can also see the Sources.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open: each opening reads who has access afresh. */}
        {open && (
          <ShareBody
            expeditionId={expeditionId}
            meId={meId}
            onAccessChanged={onAccessChanged}
            onLeft={onLeft}
            onForked={onForked}
            onTrashed={onTrashed}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

type Load =
  | { status: "loading" }
  | { status: "ready"; sharing: Sharing }
  | { status: "failed"; reason: string }

const reasonOf = (err: unknown) =>
  err instanceof Error ? err.message : String(err)

function ShareBody({
  expeditionId,
  meId,
  onAccessChanged,
  onLeft,
  onForked,
  onTrashed,
}: {
  expeditionId: string
  meId: string
  onAccessChanged: () => void
  onLeft: () => void
  onForked: (fork: ForkResult) => void
  onTrashed: () => void
}) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" })
  const [error, setError] = React.useState<string | null>(null)
  const [sent, setSent] = React.useState<InviteCreated | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      setLoad({ status: "ready", sharing: await getSharing(expeditionId) })
    } catch (err) {
      setLoad({ status: "failed", reason: reasonOf(err) })
    }
  }, [expeditionId])
  React.useEffect(() => {
    let live = true
    getSharing(expeditionId).then(
      (sharing) => live && setLoad({ status: "ready", sharing }),
      (err: unknown) =>
        live && setLoad({ status: "failed", reason: reasonOf(err) })
    )
    return () => {
      live = false
    }
  }, [expeditionId])

  /** Runs a change, then reads who has access again. */
  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(reasonOf(err))
    }
    await refresh()
  }

  if (load.status === "loading")
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  if (load.status === "failed")
    return (
      <Alert variant="destructive">
        <AlertDescription>{load.reason}</AlertDescription>
      </Alert>
    )
  const { sharing } = load
  const { may } = sharing

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {may.invite && (
        <InviteForm
          onInvite={async (email, role) => {
            setError(null)
            setSent(null)
            try {
              setSent(await invite(expeditionId, email, role))
              await refresh()
              return true
            } catch (err) {
              setError(reasonOf(err))
              return false
            }
          }}
        />
      )}
      {sent && <InviteSent sent={sent} />}
      {error && (
        <Alert variant="destructive" data-testid="share-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Separator />
      <section aria-label="People with access" className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">People with access</h3>
        <ul className="flex flex-col" data-testid="share-people">
          {sharing.collaborators.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              me={p.id === meId}
              sharing={sharing}
              onRole={(role) => act(() => changeRole(expeditionId, p.id, role))}
              onRemove={() => act(() => removeCollaborator(expeditionId, p.id))}
              onLeave={async () => {
                setError(null)
                try {
                  await removeCollaborator(expeditionId, meId)
                  onLeft()
                } catch (err) {
                  setError(reasonOf(err))
                }
              }}
              onMakeOwner={() =>
                act(async () => {
                  await transferOwnership(expeditionId, p.id)
                  onAccessChanged()
                })
              }
            />
          ))}
        </ul>
      </section>

      {sharing.invites.length > 0 && (
        <section aria-label="Invited" className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Invited</h3>
          <ul className="flex flex-col" data-testid="share-invites">
            {sharing.invites.map((inv) => (
              <li
                key={inv.id}
                className="flex min-w-0 items-center gap-3 py-1.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{inv.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    Invited by {inv.invitedBy.name}
                  </span>
                </span>
                <Badge variant="outline">{ROLE_LABEL[inv.role]}</Badge>
                {(may.removeCollaborator || inv.invitedBy.id === meId) && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Cancel the invite to ${inv.email}`}
                    onClick={() =>
                      act(() => revokeInvite(expeditionId, inv.id))
                    }
                  >
                    <XIcon />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Separator />
      <GeneralAccess
        expeditionId={expeditionId}
        visibility={sharing.visibility}
        canChange={may.changeVisibility}
        onChange={(visibility) =>
          act(() => setVisibility(expeditionId, visibility))
        }
      />

      {(may.fork || may.trashExpedition) && (
        <>
          <Separator />
          <ExpeditionActions
            canFork={may.fork}
            canTrash={may.trashExpedition}
            onFork={async () => {
              setError(null)
              try {
                onForked(await forkExpedition(expeditionId))
              } catch (err) {
                setError(reasonOf(err))
              }
            }}
            onTrash={async () => {
              setError(null)
              try {
                await trashExpedition(expeditionId)
                onTrashed()
              } catch (err) {
                setError(reasonOf(err))
              }
            }}
          />
        </>
      )}
    </div>
  )
}

/**
 * Who can open it (spec §3.9): the owner picks private, unlisted or public;
 * everyone else reads it. Opening it beyond the people with access asks
 * first, since the Sources become readable too. When it is unlisted or
 * public, the link to copy.
 */
function GeneralAccess({
  expeditionId,
  visibility,
  canChange,
  onChange,
}: {
  expeditionId: string
  visibility: Visibility
  canChange: boolean
  onChange: (visibility: Visibility) => Promise<void>
}) {
  const [confirming, setConfirming] = React.useState<Visibility | null>(null)
  const [busy, setBusy] = React.useState(false)
  const shown = VISIBILITY[visibility]
  const Icon = shown.icon
  const apply = async (next: Visibility) => {
    setConfirming(null)
    setBusy(true)
    await onChange(next)
    setBusy(false)
  }
  return (
    <section aria-label="General access" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">General access</h3>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          {busy ? <Spinner /> : <Icon className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          {canChange ? (
            <Select
              items={VISIBILITY_ITEMS}
              value={visibility}
              onValueChange={(v) => {
                const next = v as Visibility | null
                if (!next || next === visibility) return
                // Wider than the people with access: say what that shows.
                if (visibility === "private") setConfirming(next)
                else void apply(next)
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="Who can open it"
                data-testid="visibility-select"
                className="w-56"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="block text-sm" data-testid="visibility-label">
              {shown.label}
            </span>
          )}
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {shown.hint}
          </span>
        </span>
      </div>
      {confirming && (
        <Alert data-testid="confirm-visibility">
          <AlertDescription className="flex flex-col gap-2">
            <span>
              {confirming === "public"
                ? "Anyone will be able to find it and read it, Sources included."
                : "Anyone with the link will be able to read it, Sources included."}{" "}
              Anyone who can view can also see the Sources.
            </span>
            <span className="flex gap-2">
              <Button size="sm" onClick={() => void apply(confirming)}>
                {confirming === "public" ? "Make it public" : "Share the link"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirming(null)}
              >
                Cancel
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
      {visibility !== "private" && (
        <CopyLink
          label="Expedition link"
          testId="expedition-link"
          link={expeditionLink(expeditionId)}
        />
      )}
    </section>
  )
}

/** Fork (anyone signed in who can view) and Move to Trash (the owner). */
function ExpeditionActions({
  canFork,
  canTrash,
  onFork,
  onTrash,
}: {
  canFork: boolean
  canTrash: boolean
  onFork: () => Promise<void>
  onTrash: () => Promise<void>
}) {
  const [busy, setBusy] = React.useState<"fork" | "trash" | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const run = async (which: "fork" | "trash", fn: () => Promise<void>) => {
    setBusy(which)
    await fn()
    setBusy(null)
  }
  return (
    <section aria-label="This Expedition" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canFork && (
          <Button
            variant="outline"
            size="sm"
            data-testid="fork-button"
            disabled={!!busy}
            onClick={() => void run("fork", onFork)}
          >
            {busy === "fork" ? <Spinner /> : <GitForkIcon />}
            Fork
          </Button>
        )}
        {canFork && (
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            Make your own copy, with its Sources and a history of its own.
          </span>
        )}
        {canTrash && (
          <Button
            variant="destructive"
            size="sm"
            data-testid="trash-button"
            disabled={!!busy}
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon />
            Move to Trash
          </Button>
        )}
      </div>
      {confirming && (
        <Alert variant="destructive" data-testid="confirm-trash">
          <AlertDescription className="flex flex-col gap-2">
            <span>
              Move it to Trash? Nobody can open it there. You can restore it
              from the Library for 30 days; after that it is deleted for good,
              Sources included. Forks are kept.
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={!!busy}
                onClick={() => {
                  setConfirming(false)
                  void run("trash", onTrash)
                }}
              >
                Move to Trash
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}

/** A read-only link with Copy. */
function CopyLink({
  label,
  testId,
  link,
}: {
  label: string
  testId: string
  link: string
}) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      // No clipboard (an insecure origin): the link is selectable.
    }
  }
  return (
    <InputGroup>
      <InputGroupInput
        readOnly
        aria-label={label}
        data-testid={testId}
        value={link}
        onFocus={(e) => e.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          aria-label={`Copy the ${label.toLowerCase()}`}
          onClick={copy}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

function InviteForm({
  onInvite,
}: {
  onInvite: (email: string, role: InviteRole) => Promise<boolean>
}) {
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState<InviteRole>("editor")
  const [busy, setBusy] = React.useState(false)
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!valid || busy) return
        setBusy(true)
        if (await onInvite(email.trim(), role)) setEmail("")
        setBusy(false)
      }}
    >
      <Field className="min-w-0 flex-1">
        <FieldLabel htmlFor="share-email">Invite by email</FieldLabel>
        <Input
          id="share-email"
          type="email"
          autoComplete="off"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
      </Field>
      <div className="flex gap-2">
        <Select
          items={ROLE_ITEMS}
          value={role}
          onValueChange={(v) => v && setRole(v as InviteRole)}
        >
          <SelectTrigger aria-label="Invite as" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_ITEMS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={!valid || busy}>
          Invite
        </Button>
      </div>
    </form>
  )
}

function InviteSent({ sent }: { sent: InviteCreated }) {
  const who = sent.invite.email
  return (
    <Alert data-testid="invite-sent">
      <AlertDescription className="flex min-w-0 flex-col gap-2">
        <span>
          {sent.added
            ? `${who} can open it now from Shared with you.`
            : sent.emailed
              ? `We emailed ${who} an invite.`
              : `Send ${who} this link.`}{" "}
          {sent.emailed || sent.added
            ? "You can also send them this link:"
            : "It works once."}
        </span>
        <CopyLink label="Invite link" testId="invite-link" link={sent.link} />
      </AlertDescription>
    </Alert>
  )
}

function PersonRow({
  person,
  me,
  sharing,
  onRole,
  onRemove,
  onLeave,
  onMakeOwner,
}: {
  person: SharingPerson
  me: boolean
  sharing: Sharing
  onRole: (role: InviteRole) => void
  onRemove: () => void
  onLeave: () => void
  onMakeOwner: () => void
}) {
  const [confirming, setConfirming] = React.useState(false)
  const { may } = sharing
  const owner = person.role === "owner"
  const canChange = may.changeRole && !owner
  const canMakeOwner = may.transferOwnership && person.role === "editor"
  const canRemove = may.removeCollaborator && !owner
  return (
    <li
      className="flex min-w-0 flex-col gap-2 py-1.5"
      data-testid="share-person"
      data-role={person.role}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar size="sm">
          {person.image && <AvatarImage src={person.image} alt="" />}
          <AvatarFallback className="bg-secondary font-semibold text-secondary-foreground">
            {initials(person.name)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            {person.name}
            {me && <span className="text-muted-foreground"> (you)</span>}
          </span>
          {person.email && (
            <span className="block truncate text-xs text-muted-foreground">
              {person.email}
            </span>
          )}
        </span>
        {canChange ? (
          <Select
            items={ROLE_ITEMS}
            value={person.role}
            onValueChange={(v) =>
              v && v !== person.role && onRole(v as InviteRole)
            }
          >
            <SelectTrigger
              size="sm"
              aria-label={`Role of ${person.name}`}
              className="w-24"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_ITEMS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm text-muted-foreground">
            {ROLE_LABEL[person.role]}
          </span>
        )}
        {(canMakeOwner || canRemove) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`More for ${person.name}`}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canMakeOwner && (
                <DropdownMenuItem onClick={() => setConfirming(true)}>
                  <CrownIcon />
                  Make owner
                </DropdownMenuItem>
              )}
              {canRemove && (
                <DropdownMenuItem variant="destructive" onClick={onRemove}>
                  <UserMinusIcon />
                  Remove
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {me && !owner && (
          <Button variant="ghost" size="sm" onClick={onLeave}>
            <LogOutIcon />
            Leave
          </Button>
        )}
      </div>
      {confirming && (
        <Alert data-testid="confirm-transfer">
          <AlertDescription className="flex flex-col gap-2">
            <span>
              Make {person.name} the owner? You'll stay on as an editor, and
              only they can change roles or remove people.
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setConfirming(false)
                  onMakeOwner()
                }}
              >
                Make {person.name} the owner
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
    </li>
  )
}
