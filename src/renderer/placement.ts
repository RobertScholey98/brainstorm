import type { CanvasRect } from "../core/types";

/** The popover widths, as numbers placement needs; test/placement.test.ts holds them to styles.css. */
export const POPOVER_WIDTH = { sm: 320, md: 380 } as const;

/** `width` is the popover-sm step the pin composer takes, and `height` a first guess until it is measured. */
export const COMPOSER = { width: POPOVER_WIDTH.sm, height: 180, gap: 12, margin: 12 } as const;

/**
 * Where an overlay opened at a picked element goes: under the element so it stays visible, above it when there's no
 * room below, and next to the click when the element is taller than the canvas leaves room for.
 */
export function composerPlace(
  at: { readonly x: number; readonly y: number },
  rect: CanvasRect,
  bounds: { readonly width: number; readonly height: number },
  size: { readonly width: number; readonly height: number } = COMPOSER,
): { left: number; top: number } {
  const { width, height } = size;
  const { gap, margin } = COMPOSER;
  const clamp = (v: number, max: number) => Math.max(margin, Math.min(v, max));
  const left = clamp(rect.x, bounds.width - width - margin);
  const below = rect.y + rect.height + gap;
  const above = rect.y - gap - height;
  if (below + height <= bounds.height - margin) return { left, top: Math.max(margin, below) };
  if (above >= margin) return { left, top: above };
  return { left: clamp(at.x + gap, bounds.width - width - margin), top: clamp(at.y + gap, bounds.height - height - margin) };
}
