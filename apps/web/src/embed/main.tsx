// The live embed's entry (embed.html; spec §9.3). Its own bundle: none of
// the app's routes, session, editing or panels load here.
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@seply/ui/globals.css"
import "@xyflow/react/dist/style.css"
import "@seply/views/canvas.css"
import { EmbedScreen } from "./embed-screen.tsx"
import { embedParams } from "./params.ts"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EmbedScreen params={embedParams(new URL(location.href))} />
  </StrictMode>
)
