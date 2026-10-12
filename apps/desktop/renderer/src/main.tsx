import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@seply/ui/globals.css"
import { ThemeProvider } from "@seply/ui/components/theme-provider"

import { ShellPage } from "./shell-page.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ShellPage />
    </ThemeProvider>
  </StrictMode>
)
