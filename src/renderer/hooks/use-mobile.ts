import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

/** Whether the window is at least `px` wide, following resizes. */
export function useWiderThan(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  return React.useSyncExternalStore(
    (onChange) => {
      const mql = matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}

let frame = 0;

/**
 * Hears window resizes. While the width changes, body carries data-window-resizing into the frame after the one that
 * lays the new width out, so the panes that follow it move with it rather than slide.
 */
function subscribeWidth(onChange: () => void): () => void {
  const resized = () => {
    document.body.dataset.windowResizing = "";
    cancelAnimationFrame(frame);
    // Two frames: a frame asked for during the resize runs before that same frame's style pass.
    frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => delete document.body.dataset.windowResizing)));
    onChange();
  };
  addEventListener("resize", resized);
  return () => removeEventListener("resize", resized);
}

/** The window's width in CSS pixels, following resizes. */
export function useWindowWidth(): number {
  return React.useSyncExternalStore(subscribeWidth, () => innerWidth);
}
