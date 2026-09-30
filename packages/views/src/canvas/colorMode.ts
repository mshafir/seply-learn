// React Flow always puts `light` or `dark` on its container. @seply/ui reads
// those classes as theme islands (`.light` forces the light palette), so the
// canvas must carry the theme it sits in, or it would force its own. This
// follows the nearest `.dark` / `.light` ancestor: read on mount, and again
// whenever <html>'s class changes (ThemeProvider toggles `.dark` there).
import { useEffect, useState, type RefObject } from "react";

export type ColorMode = "light" | "dark";

function inherited(el: Element | null): ColorMode {
  const themed = el?.parentElement?.closest(".dark, .light");
  return themed?.classList.contains("dark") ? "dark" : "light";
}

export function useInheritedColorMode(ref: RefObject<HTMLElement | null>): ColorMode {
  const [mode, setMode] = useState<ColorMode>(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  useEffect(() => {
    const update = () => setMode(inherited(ref.current));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [ref]);
  return mode;
}
