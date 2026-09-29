import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@umbel/ui/globals.css"
import "@xyflow/react/dist/style.css"
import "@umbel/views/canvas.css"
import { ThemeProvider } from "@umbel/ui/components/theme-provider"
import { Toaster } from "@umbel/ui/components/toast"
import { TooltipProvider } from "@umbel/ui/components/tooltip"
import { App } from "./App.tsx"
import { SessionProvider } from "./components/session-provider.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <Toaster>
        <TooltipProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </TooltipProvider>
      </Toaster>
    </ThemeProvider>
  </StrictMode>
)
