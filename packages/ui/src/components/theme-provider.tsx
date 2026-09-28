import * as React from "react"

export type Theme = "system" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

/** localStorage key. The no-flash script in apps/web/index.html reads the same key. */
export const THEME_STORAGE_KEY = "umbel-theme"

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"
const THEMES: readonly Theme[] = ["system", "light", "dark"]

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  disableTransitionOnChange?: boolean
}

type ThemeContextValue = {
  /** The reader's choice: system, light or dark. */
  theme: Theme
  /** What is on screen now. For React Flow, MapLibre and vis-timeline. */
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(
  undefined
)

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEMES.includes(value as Theme)
}

function readStoredTheme(key: string, fallback: Theme): Theme {
  try {
    const stored = localStorage.getItem(key)
    return isTheme(stored) ? stored : fallback
  } catch {
    return fallback
  }
}

function subscribeToSystem(onChange: () => void) {
  const query = window.matchMedia(COLOR_SCHEME_QUERY)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? "dark" : "light"
}

function disableTransitionsTemporarily() {
  const style = document.createElement("style")
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}"
    )
  )
  document.head.appendChild(style)
  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => requestAnimationFrame(() => style.remove()))
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = THEME_STORAGE_KEY,
  disableTransitionOnChange = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() =>
    readStoredTheme(storageKey, defaultTheme)
  )

  // Live OS preference: follows changes while the app is open.
  const systemTheme = React.useSyncExternalStore(
    subscribeToSystem,
    getSystemTheme,
    () => "light" as const
  )
  const resolvedTheme: ResolvedTheme =
    theme === "system" ? systemTheme : theme

  const setTheme = React.useCallback(
    (next: Theme) => {
      try {
        localStorage.setItem(storageKey, next)
      } catch {
        // Storage can be unavailable (private mode); the choice still applies.
      }
      setThemeState(next)
    },
    [storageKey]
  )

  React.useLayoutEffect(() => {
    // Only `.dark` goes on <html>; `.light` is reserved for forced-light
    // islands (see globals.css).
    const root = document.documentElement
    const isDark = resolvedTheme === "dark"
    root.style.colorScheme = resolvedTheme
    if (root.classList.contains("dark") === isDark) return
    const restore = disableTransitionOnChange
      ? disableTransitionsTemporarily()
      : null
    root.classList.toggle("dark", isDark)
    restore?.()
  }, [resolvedTheme, disableTransitionOnChange])

  // Another tab changed the choice.
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return
      setThemeState(isTheme(event.newValue) ? event.newValue : defaultTheme)
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [storageKey, defaultTheme])

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = React.useContext(ThemeContext)
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }
  return context
}
