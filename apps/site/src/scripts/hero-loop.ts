// The hero loop (when the media manifest has one): plays unless the reader
// prefers reduced motion, with a Pause/Play button (WCAG 2.2.2). It starts
// only once the browser can play it, and stays hidden over its poster (an
// <img> underneath) until its first frame is up, so there's never a blank frame.
const video = document.querySelector<HTMLVideoElement>("[data-hero-loop]")
const toggle = document.querySelector<HTMLButtonElement>(
  "[data-hero-loop-toggle]"
)

if (video && toggle) {
  /** Waiting to start by itself: the button already offers Pause. */
  let pending = false
  const label = () => {
    toggle.textContent = video.paused && !pending ? "Play" : "Pause"
  }
  const reveal = () => video.removeAttribute("data-waiting")
  const play = () =>
    video.play().catch(() => {
      // Autoplay refused (or the file failed): show the poster and offer Play.
      pending = false
      reveal()
      label()
    })

  video.addEventListener("play", label)
  video.addEventListener("pause", label)
  video.addEventListener("playing", () => {
    pending = false
    // Reveal on the first painted frame where the browser can say so.
    if ("requestVideoFrameCallback" in video)
      video.requestVideoFrameCallback(reveal)
    else reveal()
  })
  toggle.addEventListener("click", () => {
    if (pending) {
      pending = false
      reveal()
    } else if (video.paused) void play()
    else video.pause()
    label()
  })
  toggle.hidden = false

  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    pending = true
    video.setAttribute("data-waiting", "")
    let started = false
    const start = () => {
      if (started || !pending) return
      started = true
      void play()
    }
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) start()
    else {
      video.addEventListener("canplay", start, { once: true })
      // Fetch enough to play, not just the metadata the markup asks for.
      video.preload = "auto"
      // A browser that won't buffer on its own loads once asked to play; the
      // loop stays hidden over its poster until it really plays either way.
      setTimeout(start, 3000)
    }
  }
  label()
}
