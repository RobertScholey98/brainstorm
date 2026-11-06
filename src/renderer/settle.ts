import { useEffect, useRef } from "react";
import type { SessionId, SessionListing } from "../core/types";

/** T3 Code's settle chord, so the same keys put a thread and a brainstorm away. */
export const SETTLE_SHORTCUT = "Ctrl+Shift+S";

/** Whether a settle control brings the brainstorm back rather than settling it: once settled, or waiting to settle. */
export const settleUndoes = (s: SessionListing): boolean => s.settlement.state !== "active";

export const settleLabel = (s: SessionListing): string => (settleUndoes(s) ? "Un-settle" : "Settle");

/** The elements that stand for one brainstorm: a sidebar row, an overview card, or the settle control beside either. */
const SESSION_TARGET = "[data-session], [data-overview-session], [data-settle]";

/**
 * The settle chord toggles the brainstorm Rob has focused in a list, or else the one open. With neither, it does
 * nothing, so it never settles one he can't see.
 */
export function useSettleShortcut(sessions: readonly SessionListing[] | null, open: SessionId | null, toggle: (s: SessionListing) => void) {
  const latest = useRef({ sessions, open, toggle });
  latest.current = { sessions, open, toggle };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== "s") return;
      const { sessions, open, toggle } = latest.current;
      const target = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>(SESSION_TARGET) : null;
      const id = target?.dataset.session ?? target?.dataset.overviewSession ?? target?.dataset.settle ?? open;
      const session = sessions?.find((s) => s.id === id);
      if (session === undefined) return;
      e.preventDefault();
      toggle(session);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
