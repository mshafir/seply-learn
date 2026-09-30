// Skim fixtures (test and script use only; not exported from the package):
// the synthetic chats in fixtures/skim/ (written for WP-3.4 on public topics:
// learning sourdough, choosing an e-bike, a rail trip in Portugal) and the
// committed research doc, segmented the way WP-3.1 segments a paste or a
// Markdown upload. Never real chats.
import { segmentsDoc, segmentText } from "@seply/domain"
import { readFileSync } from "node:fs"
import type { SkimSource } from "./skim.ts"

const root = new URL("../../../", import.meta.url)

function source(id: string, title: string, text: string, format: "chat-paste" | "markdown"): SkimSource {
  const { kind, segments } = segmentText(text)
  return {
    id,
    title,
    kind: kind === "chat" ? "chat" : "file",
    segments: segmentsDoc(kind, kind === "chat" ? "chat-paste" : format, segments),
  }
}

const chat = (name: string) =>
  readFileSync(new URL(`packages/ai/fixtures/skim/${name}`, root), "utf8")

export type SkimFixture = { name: string; sources: SkimSource[] }

export function skimFixtures(): SkimFixture[] {
  return [
    {
      name: "sourdough (learning chat)",
      sources: [source("src-sourdough", "Sourdough chat", chat("sourdough-learning-chat.txt"), "chat-paste")],
    },
    {
      name: "e-bike (decision chat)",
      sources: [source("src-ebike", "E-bike chat", chat("ebike-decision-chat.txt"), "chat-paste")],
    },
    {
      name: "rail trip (planning chat)",
      sources: [source("src-trip", "Portugal by train", chat("rail-trip-chat.txt"), "chat-paste")],
    },
    {
      name: "research doc",
      sources: [
        source(
          "src-research",
          "Knowledge graph learning tools",
          readFileSync(new URL("docs/research/knowledge-graph-learning-tools.md", root), "utf8"),
          "markdown"
        ),
      ],
    },
  ]
}
