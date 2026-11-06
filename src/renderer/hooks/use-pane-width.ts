import { useCallback, useState } from "react";

export type PaneLimits = { readonly fallback: number; readonly min: number; readonly max: number };

const key = (pane: string) => `brainstorm.pane.${pane}`;

const clamp = (v: number, { min, max }: PaneLimits) => Math.round(Math.max(min, Math.min(max, v)));

/** A stored width read back within the limits, or null when none is usable. Storage can be missing or throw. */
export function readWidth(pane: string, limits: PaneLimits, storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): number | null {
  try {
    const stored = Number(storage?.getItem(key(pane)));
    return stored > 0 ? clamp(stored, limits) : null;
  } catch {
    return null;
  }
}

/** A pane width Rob drags, remembered on this machine. Until he drags it, it follows `limits.fallback`. */
export function usePaneWidth(pane: string, limits: PaneLimits): [number, (width: number) => void] {
  const [stored, setStored] = useState(() => readWidth(pane, limits));
  const set = useCallback(
    (next: number) => {
      const v = clamp(next, limits);
      setStored(v);
      try {
        localStorage.setItem(key(pane), String(v));
      } catch {
        // Not remembering a width is fine; the drag still applies.
      }
    },
    [pane, limits],
  );
  return [stored ?? limits.fallback, set];
}
