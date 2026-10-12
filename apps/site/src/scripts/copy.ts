// Copy buttons: each `pre[data-copy]` (landing snippets, and every code block
// on /self-host) gets a button that copies its text. `data-copy` names the
// snippet for the button's accessible name.
const COPY = "Copy"

for (const pre of document.querySelectorAll<HTMLPreElement>("pre[data-copy]")) {
  const wrap = document.createElement("div")
  wrap.className = "copy-wrap"
  pre.replaceWith(wrap)
  wrap.append(pre)

  const button = document.createElement("button")
  button.type = "button"
  button.className = "copy-button"
  button.textContent = COPY
  const name = pre.dataset.copy
  if (name) button.setAttribute("aria-label", `Copy ${name}`)
  const status = document.createElement("span")
  status.className = "sr-only"
  status.setAttribute("role", "status")
  wrap.append(button, status)

  let timer: number | undefined
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(
        (pre.textContent ?? "").replace(/\n$/, "")
      )
      button.textContent = status.textContent = "Copied"
    } catch {
      button.textContent = status.textContent = "Copy failed"
    }
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      button.textContent = COPY
      status.textContent = ""
    }, 2000)
  })
}
