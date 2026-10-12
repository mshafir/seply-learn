// The phone menu: the button toggles the panel; a link, Escape or growing
// past the breakpoint closes it.
const button = document.querySelector<HTMLButtonElement>("[data-menu-button]")
const panel = document.querySelector<HTMLElement>("[data-menu]")

if (button && panel) {
  const set = (open: boolean) => {
    panel.hidden = !open
    button.setAttribute("aria-expanded", String(open))
  }
  button.addEventListener("click", () => set(Boolean(panel.hidden)))
  panel.addEventListener("click", (e) => {
    if ((e.target as Element).closest("a")) set(false)
  })
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      set(false)
      button.focus()
    }
  })
  matchMedia("(min-width: 48rem)").addEventListener("change", (e) => {
    if (e.matches) set(false)
  })
}
