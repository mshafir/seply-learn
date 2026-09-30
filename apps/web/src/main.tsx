import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@seply/ui/globals.css"
import "@xyflow/react/dist/style.css"
import "@seply/views/canvas.css"
import { ThemeProvider } from "@seply/ui/components/theme-provider"
import { Toaster } from "@seply/ui/components/toast"
import { TooltipProvider } from "@seply/ui/components/tooltip"
import { App } from "./App.tsx"
import { ReaderProvider } from "./components/reader-provider.tsx"
import { SessionProvider } from "./components/session-provider.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <Toaster>
        <TooltipProvider>
          <SessionProvider>
            <ReaderProvider>
              <App />
            </ReaderProvider>
          </SessionProvider>
        </TooltipProvider>
      </Toaster>
    </ThemeProvider>
  </StrictMode>
)
