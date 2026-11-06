import { useCallback, useState } from "react";

export type PaneLimits = { readonly fallback: number; readonly min: number; readonly max: number };

const key = (pane: string) => `brainstorm.pane.${pane}`;

const clamp = (v: number, { min, max }: PaneLimits) => Math.round(Math.max(min, Math.min(max, v)));

/** A stored width read back within the limits. Storage can be missing or throw, which leaves the fallback. */
export function readWidth(pane: string, limits: PaneLimits, storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): number {
  try {
    const stored = Number(storage?.getItem(key(pane)));
    return stored > 0 ? clamp(stored, limits) : limits.fallback;
  } catch {
    return limits.fallback;
  }
}

/** A pane width Rob drags, remembered on this machine. */
export function usePaneWidth(pane: string, limits: PaneLimits): [number, (width: number) => void] {
  const [width, setWidth] = useState(() => readWidth(pane, limits));
  const set = useCallback(
    (next: number) => {
      const v = clamp(next, limits);
      setWidth(v);
      try {
        localStorage.setItem(key(pane), String(v));
      } catch {
        // Not remembering a width is fine; the drag still applies.
      }
    },
    [pane, limits],
  );
  return [width, set];
}
