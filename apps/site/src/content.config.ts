// Content the site renders from the repo itself: docs/self-host.md is the one
// source of the /self-host page (spec 9.2), docs/desktop.md of /desktop.
import { defineCollection } from "astro:content"
import { glob } from "astro/loaders"

const docs = defineCollection({
  loader: glob({ pattern: "{self-host,desktop}.md", base: "../../docs" }),
})

export const collections = { docs }
