import { useLayoutEffect, useRef, useState } from "react";
import type { CanvasRect } from "../core/types";
import { COMPOSER, composerPlace } from "./placement";

/**
 * `composerPlace` at the overlay's real height, measured before it paints and again whenever it grows, so a tall
 * overlay placed above its element never comes down over it.
 */
export function useComposerPlace(
  at: { readonly x: number; readonly y: number },
  rect: CanvasRect,
  bounds: { readonly width: number; readonly height: number },
  width: number,
) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(COMPOSER.height);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, ...composerPlace(at, rect, bounds, { width, height }) };
}
