// The hero loop (when the media manifest has one): plays unless the reader
// prefers reduced motion, with a Pause/Play button (WCAG 2.2.2).
const video = document.querySelector<HTMLVideoElement>("[data-hero-loop]")
const toggle = document.querySelector<HTMLButtonElement>(
  "[data-hero-loop-toggle]"
)

if (video && toggle) {
  const label = () => {
    toggle.textContent = video.paused ? "Play" : "Pause"
  }
  video.addEventListener("play", label)
  video.addEventListener("pause", label)
  toggle.addEventListener("click", () => {
    if (video.paused) void video.play()
    else video.pause()
  })
  toggle.hidden = false
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
    void video.play().catch(() => {})
  label()
}
