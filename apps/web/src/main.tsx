import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@umbel/ui/globals.css"
import { ThemeProvider } from "@umbel/ui/components/theme-provider"
import { Toaster } from "@umbel/ui/components/toast"
import { App } from "./App.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <Toaster>
        <App />
      </Toaster>
    </ThemeProvider>
  </StrictMode>
)
