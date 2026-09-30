// AI chat exports (spec §3.3): the JSON each assistant's data export holds.
//
// - ChatGPT: conversations.json, an array of conversations, each a tree of
//   messages (`mapping`, `current_node`); the branch that ends at
//   `current_node` is the one the reader saw last.
// - Claude: conversations.json, an array of conversations, each with a list
//   of `chat_messages` (`sender`: human | assistant).
// - Gemini: Google Takeout's "Gemini Apps" My Activity JSON, one item per
//   prompt ("Prompted …") with the response as HTML in `safeHtmlItem`.
//
// A single conversation object (not in an array) is read too. Each turn
// carries its conversation's title when the export holds more than one.
import type { Speaker, SourceFormat, Turn } from "@seply/domain"

import { htmlToMarkdown } from "./html.ts"

export type ChatExport = {
  format: Extract<
    SourceFormat,
    "chatgpt-export" | "claude-export" | "gemini-export"
  >
  /** The conversation's title when there is one, else a description. */
  title: string
  conversations: number
  turns: Turn[]
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === "string" ? v : "")

// ─── ChatGPT ───────────────────────────────────────────────────────────────

const isChatGpt = (c: unknown): c is Json =>
  isObj(c) && isObj(c.mapping) && "current_node" in c

function chatGptText(message: Json): string {
  const content = isObj(message.content) ? message.content : {}
  if (Array.isArray(content.parts))
    return content.parts
      .map((p) => (typeof p === "string" ? p : isObj(p) ? str(p.text) : ""))
      .filter(Boolean)
      .join("\n\n")
  return str(content.text)
}

function chatGptTurns(c: Json): Turn[] {
  const mapping = c.mapping as Record<string, Json>
  // Root to leaf: up from the current node, then reversed.
  const path: Json[] = []
  const seen = new Set<string>()
  let id: string | null = str(c.current_node) || null
  while (id && mapping[id] && !seen.has(id)) {
    seen.add(id)
    path.unshift(mapping[id]!)
    id = str(mapping[id]!.parent) || null
  }
  // No current node (older exports): first children down from the root.
  if (!path.length) {
    let node = Object.values(mapping).find((n) => !n.parent)
    while (node && !seen.has(str(node.id))) {
      seen.add(str(node.id))
      path.push(node)
      const next: unknown = Array.isArray(node.children)
        ? node.children[0]
        : undefined
      node = typeof next === "string" ? mapping[next] : undefined
    }
  }
  const turns: Turn[] = []
  for (const node of path) {
    const m = isObj(node.message) ? node.message : null
    if (!m) continue
    const role = isObj(m.author) ? str(m.author.role) : ""
    if (role !== "user" && role !== "assistant") continue
    const meta = isObj(m.metadata) ? m.metadata : {}
    if (meta.is_visually_hidden_from_conversation) continue
    const text = chatGptText(m).trim()
    if (text) turns.push({ speaker: role, text })
  }
  return turns
}

// ─── Claude ────────────────────────────────────────────────────────────────

const isClaude = (c: unknown): c is Json =>
  isObj(c) && Array.isArray(c.chat_messages)

function claudeTurns(c: Json): Turn[] {
  const turns: Turn[] = []
  for (const m of c.chat_messages as unknown[]) {
    if (!isObj(m)) continue
    const sender = str(m.sender)
    const speaker: Speaker | null =
      sender === "human" ? "user" : sender === "assistant" ? "assistant" : null
    if (!speaker) continue
    const blocks = Array.isArray(m.content)
      ? m.content
          .filter((b) => isObj(b) && b.type === "text")
          .map((b) => str((b as Json).text))
          .filter(Boolean)
      : []
    const text = (blocks.length ? blocks.join("\n\n") : str(m.text)).trim()
    if (text) turns.push({ speaker, text })
  }
  return turns
}

// ─── Gemini (Google Takeout My Activity) ───────────────────────────────────

const isGeminiItem = (c: unknown): c is Json =>
  isObj(c) &&
  typeof c.title === "string" &&
  (str(c.header).startsWith("Gemini") ||
    (Array.isArray(c.products) &&
      c.products.some((p) => str(p).startsWith("Gemini"))))

function geminiTurns(items: Json[]): Turn[] {
  // Takeout lists activity newest first; a chat reads oldest first.
  const ordered = [...items].sort((a, b) =>
    str(a.time).localeCompare(str(b.time))
  )
  const turns: Turn[] = []
  for (const item of ordered) {
    const prompt = str(item.title)
      .replace(/^Prompted\s+/, "")
      .trim()
    if (!str(item.title).startsWith("Prompted")) continue
    const html = Array.isArray(item.safeHtmlItem)
      ? item.safeHtmlItem.map((h) => (isObj(h) ? str(h.html) : "")).join("\n")
      : ""
    if (prompt) turns.push({ speaker: "user", text: prompt })
    const answer = html ? htmlToMarkdown(html) : ""
    if (answer) turns.push({ speaker: "assistant", text: answer })
  }
  return turns
}

// ─── Detection ─────────────────────────────────────────────────────────────

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

function conversations(
  list: Json[],
  turnsOf: (c: Json) => Turn[],
  titleOf: (c: Json) => string,
  format: ChatExport["format"],
  label: string
): ChatExport {
  const several = list.length > 1
  const turns = list.flatMap((c) => {
    const t = turnsOf(c)
    const title = titleOf(c).trim() || "Untitled conversation"
    return several ? t.map((x) => ({ ...x, conversation: title })) : t
  })
  return {
    format,
    title: several
      ? `${label} export (${plural(list.length, "conversation")})`
      : titleOf(list[0]!).trim() || `${label} conversation`,
    conversations: list.length,
    turns,
  }
}

/** A chat export's turns, or null when `json` isn't one we know. */
export function readChatExport(json: unknown): ChatExport | null {
  const list = Array.isArray(json) ? json : [json]
  if (!list.length) return null
  if (list.every(isChatGpt))
    return conversations(
      list,
      chatGptTurns,
      (c) => str(c.title),
      "chatgpt-export",
      "ChatGPT"
    )
  if (list.every(isClaude))
    return conversations(
      list,
      claudeTurns,
      (c) => str(c.name),
      "claude-export",
      "Claude"
    )
  const gemini = list.filter(isGeminiItem)
  if (gemini.length && gemini.length === list.length) {
    const turns = geminiTurns(gemini)
    return {
      format: "gemini-export",
      title: "Gemini activity",
      conversations: 1,
      turns,
    }
  }
  return null
}
