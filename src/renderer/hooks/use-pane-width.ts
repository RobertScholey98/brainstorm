import { useCallback, useEffect, useRef, useState } from "react";

export type PaneLimits = { readonly fallback: number; readonly min: number; readonly max: number };

export const clampWidth = (v: number, { min, max }: PaneLimits) => Math.round(Math.max(min, Math.min(max, v)));

/** How long a drag must rest before its width is saved, so one drag is one write. */
const SAVE_MS = 300;

/**
 * A pane width Rob drags, starting from the one the server kept. Until he drags it, it follows `limits.fallback`, which
 * changes with the window's width. `save` hears each width once the drag rests, and a pending one on unmount.
 */
export function usePaneWidth(stored: number | null, limits: PaneLimits, save: (width: number) => void): [number, (width: number) => void] {
  const [width, setWidth] = useState(stored === null ? null : clampWidth(stored, limits));
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; width: number } | null>(null);
  const saver = useRef(save);
  saver.current = save;
  useEffect(
    () => () => {
      if (pending.current === null) return;
      clearTimeout(pending.current.timer);
      saver.current(pending.current.width);
    },
    [],
  );
  const set = useCallback(
    (next: number) => {
      const v = clampWidth(next, limits);
      setWidth(v);
      if (pending.current !== null) clearTimeout(pending.current.timer);
      pending.current = {
        width: v,
        timer: setTimeout(() => {
          pending.current = null;
          saver.current(v);
        }, SAVE_MS),
      };
    },
    [limits],
  );
  return [width ?? limits.fallback, set];
}
