// Tabs (WAI-ARIA tabs pattern, automatic activation): click or the arrow
// keys, Home and End pick a tab and show its panel.
for (const root of document.querySelectorAll<HTMLElement>("[data-tabs]")) {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const select = (tab: HTMLButtonElement, focus = false) => {
    for (const t of tabs) {
      const on = t === tab
      t.setAttribute("aria-selected", String(on))
      t.tabIndex = on ? 0 : -1
      const panel = document.getElementById(
        t.getAttribute("aria-controls") ?? ""
      )
      if (panel) panel.hidden = !on
    }
    if (focus) tab.focus()
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab))
    tab.addEventListener("keydown", (e) => {
      const next = {
        ArrowRight: tabs[(i + 1) % tabs.length],
        ArrowLeft: tabs[(i - 1 + tabs.length) % tabs.length],
        Home: tabs[0],
        End: tabs[tabs.length - 1],
      }[e.key]
      if (next) {
        e.preventDefault()
        select(next, true)
      }
    })
  })
}
