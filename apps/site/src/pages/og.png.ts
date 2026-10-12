// /og.png: the Open Graph card, rendered once at build time (src/lib/og.ts).
import type { APIRoute } from "astro"

import { HEADLINE } from "../learn/copy"
import { renderOgCard } from "../lib/og"

export const GET: APIRoute = async () =>
  new Response(new Uint8Array(await renderOgCard(HEADLINE)), {
    headers: { "content-type": "image/png" },
  })
